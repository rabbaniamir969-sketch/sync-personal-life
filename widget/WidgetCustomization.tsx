import { createWidgetSnapshot, type WidgetSourceData } from "./snapshot";
import { WIDGET_MODULES } from "./catalog";
import { prioritizeWidgetTasks } from "./priority-engine";
import { updateTaskPriority } from "./configuration";
import type { WidgetConfiguration, WidgetModuleId } from "./types";

type Props = {
  configuration: WidgetConfiguration;
  sourceData: WidgetSourceData;
  now: Date;
  syncError: string;
  onBack: () => void;
  onChange: (configuration: WidgetConfiguration) => void;
};

const previewSizeLabels = {
  small: "Ringkas",
  medium: "Sedang",
  large: "Lengkap"
} as const;

export function WidgetCustomization({ configuration, sourceData, now, syncError, onBack, onChange }: Props) {
  const snapshot = createWidgetSnapshot(sourceData, now);
  const orderedModules = WIDGET_MODULES
    .map(definition => ({ definition, settings: configuration.modules[definition.id] }))
    .sort((left, right) => left.settings.order - right.settings.order);
  const enabledModules = orderedModules.filter(({ definition, settings }) =>
    definition.available && (settings.enabled || settings.alwaysVisible)
  );
  const moduleCapacity = configuration.size === "small" ? 2 : configuration.size === "medium" ? 4 : enabledModules.length;
  const capacityCandidates = [...enabledModules].sort((left, right) =>
    Number(right.settings.alwaysVisible) - Number(left.settings.alwaysVisible)
    || right.settings.priority - left.settings.priority
    || left.settings.order - right.settings.order
  );
  const selectedIds = new Set(capacityCandidates.slice(0, moduleCapacity).map(module => module.definition.id));
  enabledModules.filter(module => module.settings.alwaysVisible)
    .forEach(module => selectedIds.add(module.definition.id));
  const visibleModules = enabledModules.filter(module => selectedIds.has(module.definition.id));
  const prioritizedTasks = prioritizeWidgetTasks(
    snapshot.modules.tasks.items,
    configuration.taskPriorities,
    snapshot.asOfDate,
    configuration.smartPriorityEnabled
  );

  function updateConfiguration(changes: Partial<WidgetConfiguration>) {
    onChange({ ...configuration, ...changes });
  }

  function updateModule(id: WidgetModuleId, changes: Partial<WidgetConfiguration["modules"][WidgetModuleId]>) {
    updateConfiguration({
      modules: { ...configuration.modules, [id]: { ...configuration.modules[id], ...changes } }
    });
  }

  function moveModule(id: WidgetModuleId, direction: -1 | 1) {
    const index = orderedModules.findIndex(module => module.definition.id === id);
    const target = orderedModules[index + direction];
    if (!target || configuration.modules[id].locked || target.settings.locked) return;
    const modules = { ...configuration.modules };
    modules[id] = { ...modules[id], order: target.settings.order };
    modules[target.definition.id] = { ...target.settings, order: configuration.modules[id].order };
    updateConfiguration({ modules });
  }

  function updateTask(id: string, changes: Partial<WidgetConfiguration["taskPriorities"][string]>) {
    updateConfiguration({
      taskPriorities: updateTaskPriority(configuration.taskPriorities, id, changes)
    });
  }

  function renderModulePreview(id: WidgetModuleId) {
    const settings = configuration.modules[id];
    const selectedFields = new Set(settings.fields);
    const text = (field: string, value: string) => <span key={field} className="widget-preview-text">{value}</span>;

    if (id === "tasks") {
      const tasks = prioritizedTasks.slice(0, settings.itemLimit);
      return tasks.length ? tasks.map(({ task, reason }) => <div className="widget-preview-item" key={task.id}>
        {selectedFields.has("title") && text("title", task.title)}
        {selectedFields.has("dueDate") && text("dueDate", task.dueDate || "Tanpa tenggat")}
        {selectedFields.has("priority") && <small>{reason}</small>}
      </div>) : <small>Belum ada tugas aktif.</small>;
    }

    if (id === "calendar" || id === "reminders") {
      const items = (id === "calendar" ? snapshot.modules.calendar.items : snapshot.modules.reminders.items)
        .slice(0, settings.itemLimit);
      return items.length ? items.map(item => <div className="widget-preview-item" key={item.id}>
        {selectedFields.has("title") && text("title", item.title)}
        {selectedFields.has("date") && text("date", new Date(item.date).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }))}
        {"type" in item && selectedFields.has("type") && text("type", item.type === "task" ? "Tugas" : "Pengingat")}
      </div>) : <small>Belum ada agenda.</small>;
    }

    if (id === "finance") {
      const finance = snapshot.modules.finance.items[0];
      if (!finance) return <small>Ringkasan keuangan belum tersedia.</small>;
      return <div className="widget-preview-finance">
        {selectedFields.has("balance") && <span>Saldo <b>{configuration.showSensitiveInfo ? moneyPreview(finance.balance) : "••••••"}</b></span>}
        {selectedFields.has("monthIncome") && <span>Pemasukan <b>{configuration.showSensitiveInfo ? moneyPreview(finance.monthIncome) : "••••••"}</b></span>}
        {selectedFields.has("monthExpenses") && <span>Pengeluaran <b>{configuration.showSensitiveInfo ? moneyPreview(finance.monthExpenses) : "••••••"}</b></span>}
        {selectedFields.has("monthlyBudget") && <span>Anggaran <b>{configuration.showSensitiveInfo ? moneyPreview(finance.monthlyBudget) : "••••••"}</b></span>}
      </div>;
    }

    if (id === "goals") {
      const goals = snapshot.modules.goals.items.slice(0, settings.itemLimit);
      return goals.length ? goals.map(goal => <div className="widget-preview-item" key={goal.id}>
        {selectedFields.has("title") && text("title", goal.title)}
        {selectedFields.has("progressPercent") && <span className="widget-progress">{goal.progressPercent}%</span>}
        {selectedFields.has("saved") && text("saved", configuration.showSensitiveInfo ? moneyPreview(goal.saved) : "••••••")}
        {selectedFields.has("target") && text("target", configuration.showSensitiveInfo ? moneyPreview(goal.target) : "••••••")}
      </div>) : <small>Belum ada target aktif.</small>;
    }

    if (id === "habits") {
      const habits = snapshot.modules.habits.items.slice(0, settings.itemLimit);
      return habits.length ? habits.map(habit => <div className="widget-preview-item" key={habit.id}>
        {selectedFields.has("title") && text("title", habit.title)}
        {selectedFields.has("doneToday") && text("doneToday", habit.doneToday ? "Selesai" : "Belum")}
      </div>) : <small>Belum ada habit.</small>;
    }

    if (id === "productivity") {
      const summary = snapshot.modules.productivity.items[0];
      return summary ? <div className="widget-preview-finance">
        {selectedFields.has("completedTasks") && <span>Tugas selesai <b>{summary.completedTasks}</b></span>}
        {selectedFields.has("pendingTasks") && <span>Tugas aktif <b>{summary.pendingTasks}</b></span>}
        {selectedFields.has("completedHabits") && <span>Habit selesai hari ini <b>{summary.completedHabits}</b></span>}
        {selectedFields.has("totalHabits") && <span>Jumlah habit <b>{summary.totalHabits}</b></span>}
      </div> : <small>Belum ada ringkasan produktivitas.</small>;
    }
    return <small>Modul ini belum memiliki data SYNC.</small>;
  }

  return <section className="content widget-customization">
    <div className="section-actions"><div><h2>SYNC Settings → Widget Customization</h2><p>Atur isi, urutan, prioritas, dan privasi Home Screen Widget.</p></div><button className="settings-secondary-button" type="button" onClick={onBack}>← Pengaturan</button></div>
    <div className="widget-custom-layout">
      <div className="widget-custom-controls">
        <div className="panel widget-control-panel">
          <div className="panel-head"><div><h3>Pengaturan umum</h3><p>Preferensi tersimpan otomatis di data lokal SYNC.</p></div></div>
          <div className="widget-settings-grid">
            <label className="widget-setting-field">Ukuran awal
              <select value={configuration.size} onChange={event => updateConfiguration({ size: event.target.value as WidgetConfiguration["size"] })}>
                {Object.entries(previewSizeLabels).map(([size, label]) => <option key={size} value={size}>{label}</option>)}
              </select>
            </label>
            <label className="widget-setting-field">Pembaruan berkala
              <select value={configuration.refreshMinutes} onChange={event => updateConfiguration({ refreshMinutes: Number(event.target.value) })}>
                {[15, 30, 60, 120].map(minutes => <option key={minutes} value={minutes}>Setiap {minutes} menit</option>)}
              </select>
            </label>
            <label className="widget-setting-toggle"><input type="checkbox" checked={configuration.smartPriorityEnabled} onChange={event => updateConfiguration({ smartPriorityEnabled: event.target.checked })}/><span><b>Smart Priority</b><small>Urutkan tugas berdasar tenggat dan prioritas; tugas terkunci tetap pada posisinya.</small></span></label>
            <label className="widget-setting-toggle"><input type="checkbox" checked={configuration.showSensitiveInfo} onChange={event => updateConfiguration({ showSensitiveInfo: event.target.checked })}/><span><b>Tampilkan nominal sensitif</b><small>Nonaktif berarti saldo dan nominal target disamarkan pada widget dan preview.</small></span></label>
          </div>
        </div>

        <div className="panel widget-control-panel">
          <div className="panel-head"><div><h3>Modul & urutan</h3><p>Matikan modul atau gunakan tombol panah untuk mengatur urutannya.</p></div></div>
          <div className="widget-module-list">
            {orderedModules.map(({ definition, settings }, index) => <article className={`widget-module-card ${!definition.available ? "unavailable" : ""}`} key={definition.id}>
              <div className="widget-module-heading">
                <label className="widget-setting-toggle module-enable-toggle">
                  <input type="checkbox" checked={settings.enabled} disabled={!definition.available} onChange={event => updateModule(definition.id, { enabled: event.target.checked })}/>
                  <span><b>{definition.label}</b><small>{definition.description}</small></span>
                </label>
                <div className="widget-order-actions">
                  <button type="button" aria-label={`Naikkan ${definition.label}`} title="Naikkan" disabled={index === 0 || settings.locked} onClick={() => moveModule(definition.id, -1)}>↑</button>
                  <button type="button" aria-label={`Turunkan ${definition.label}`} title="Turunkan" disabled={index === orderedModules.length - 1 || settings.locked} onClick={() => moveModule(definition.id, 1)}>↓</button>
                </div>
              </div>
              {definition.available && <div className="widget-module-options">
                <label className="widget-setting-field">Ukuran bagian
                  <select value={settings.presentation} onChange={event => updateModule(definition.id, { presentation: event.target.value as WidgetConfiguration["modules"][WidgetModuleId]["presentation"] })}>
                    <option value="compact">Ringkas</option><option value="comfortable">Nyaman</option><option value="expanded">Luas</option>
                  </select>
                </label>
                <label className="widget-setting-field">Prioritas modul · {settings.priority}
                  <input type="range" min="0" max="5" value={settings.priority} onChange={event => updateModule(definition.id, { priority: Number(event.target.value) })}/>
                </label>
                <label className="widget-setting-field">Jumlah item
                  <input type="number" min="1" max="10" value={settings.itemLimit} onChange={event => updateModule(definition.id, { itemLimit: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })}/>
                </label>
                <label className="widget-setting-toggle"><input type="checkbox" checked={settings.alwaysVisible} onChange={event => updateModule(definition.id, { alwaysVisible: event.target.checked })}/><span><b>Selalu tampil</b><small>Utamakan modul ini saat ukuran widget terbatas.</small></span></label>
                <label className="widget-setting-toggle"><input type="checkbox" checked={settings.locked} onChange={event => updateModule(definition.id, { locked: event.target.checked })}/><span><b>Kunci urutan</b><small>Tahan posisi modul saat pengaturan prioritas diterapkan.</small></span></label>
                <fieldset className="widget-field-options"><legend>Informasi ditampilkan</legend>
                  {definition.fields.map(field => <label key={field.id}><input type="checkbox" checked={settings.fields.includes(field.id)} onChange={event => updateModule(definition.id, { fields: event.target.checked ? [...settings.fields, field.id] : settings.fields.filter(id => id !== field.id) })}/>{field.label}</label>)}
                </fieldset>
              </div>}
            </article>)}
          </div>
        </div>

        <div className="panel widget-control-panel">
          <div className="panel-head"><div><h3>Prioritas tugas manual</h3><p>Sematkan atau kunci tugas. Preferensi ini tidak mengubah data tugas SYNC.</p></div></div>
          {sourceData.tasks.filter(task => !task.done).length === 0
            ? <div className="empty-state">Belum ada tugas aktif untuk diatur.</div>
            : <div className="widget-task-priorities">{sourceData.tasks.map(task => {
              if (task.done) return null;
              const settings = configuration.taskPriorities[task.id] ?? { pinned: false, importance: 0 as const, locked: false };
              return <article className="widget-task-priority" key={task.id}>
                <div><b>{task.title}</b><small>{task.date || "Tanpa tenggat"} · Prioritas tugas {task.priority.toLowerCase()}</small></div>
                <label><input type="checkbox" checked={settings.pinned} onChange={event => updateTask(task.id, { pinned: event.target.checked })}/>Sematkan</label>
                <label>Kepentingan
                  <select value={settings.importance} onChange={event => updateTask(task.id, { importance: Number(event.target.value) as 0 | 1 | 2 | 3 })}>
                    <option value={0}>Normal</option><option value={1}>Penting</option><option value={2}>Sangat penting</option><option value={3}>Kritis</option>
                  </select>
                </label>
                <label><input type="checkbox" checked={settings.locked} onChange={event => updateTask(task.id, { locked: event.target.checked })}/>Kunci posisi</label>
                {settings.pinned && <small className="widget-priority-explanation">Disematkan manual · akan didahulukan dari prioritas otomatis.</small>}
              </article>;
            })}</div>}
        </div>
      </div>

      <aside className="widget-preview-column">
        <div className="panel widget-preview-panel">
          <div className="panel-head"><div><h3>Preview widget</h3><p>Pratinjau mengikuti konfigurasi dan data tersimpan.</p></div></div>
          <div className={`widget-preview widget-preview-${configuration.size}`}>
            <div className="widget-preview-header"><span>SYNC <small>PERSONAL COMMAND CENTER</small></span><time>{snapshot.asOfDate}</time></div>
            {visibleModules.length === 0
              ? <div className="widget-preview-empty">Pilih setidaknya satu modul untuk ditampilkan.</div>
              : visibleModules.map(({ definition, settings }) => <section className={`widget-preview-module widget-preview-module-${settings.presentation}`} key={definition.id}>
                <h4>{definition.label}</h4>
                {renderModulePreview(definition.id)}
              </section>)}
            <footer>Diperbarui {new Date(snapshot.updatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</footer>
          </div>
          {syncError && <p className="widget-sync-error" role="alert">{syncError}</p>}
          <p className="widget-preview-note">Preview ini menampilkan data yang benar-benar tersimpan di SYNC. Widget Android native sedang disiapkan.</p>
        </div>
      </aside>
    </div>
  </section>;
}

function moneyPreview(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}
