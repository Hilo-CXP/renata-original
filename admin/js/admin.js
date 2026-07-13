(() => {
  const content = document.getElementById('content');
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  const lockBadge = document.getElementById('lockBadge');
  const btnLock = document.getElementById('btnLockSchedule');

  const state = {
    view: 'calendar',
    calView: 'month',
    currentDate: new Date(),
    selectedDate: new Date().toISOString().slice(0, 10),
    settings: null,
    appointments: [],
    waitingList: [],
    services: [],
  };

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const DAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const DAY_FULL = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  async function api(path, options = {}) {
    const res = await fetch(`/api/admin${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('Sessão expirada');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro');
    return data;
  }

  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fmtBR(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function openModal(html) {
    modalBody.innerHTML = html;
    modal.hidden = false;
    modal.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', closeModal);
    });
  }

  function closeModal() {
    modal.hidden = true;
    modalBody.innerHTML = '';
  }

  function updateLockUI() {
    const locked = state.settings?.schedule_locked;
    lockBadge.textContent = locked ? 'Agenda fechada' : 'Agenda aberta';
    lockBadge.classList.toggle('locked', !!locked);
    btnLock.textContent = locked ? 'Abrir agenda' : 'Fechar agenda';
    btnLock.classList.toggle('unlocked', !!locked);
  }

  async function loadSettings() {
    state.settings = await api('/settings');
    updateLockUI();
  }

  async function loadAppointments(from, to) {
    state.appointments = await api(`/appointments?from=${from}&to=${to}`);
  }

  function apptsForDate(dateStr) {
    return state.appointments
      .filter((a) => a.date === dateStr)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  function apptChipClass(appt) {
    return appt.status === 'cancelled' ? 'appt-chip cancelled' : 'appt-chip';
  }

  function statusLabel(s) {
    return { pending: 'Pendente', confirmed: 'Confirmada', cancelled: 'Cancelada', rescheduled: 'Reagendada',
      waiting: 'Aguardando', contacted: 'Contactado', scheduled: 'Agendado' }[s] || s;
  }

  function attendanceLabel(type) {
    return type === 'online' ? 'Online' : 'Presencial';
  }

  function apptForm(appt = {}) {
    const attendance = appt.attendance_type || 'presencial';
    const svcOpts = state.services.map((s) =>
      `<option value="${s.id}" ${appt.service_id === s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');
    return `
      <h3>${appt.id ? 'Editar consulta' : 'Nova consulta'}</h3>
      <form id="apptForm">
        <div class="field"><label>Nome *</label><input name="patient_name" value="${appt.patient_name || ''}" required></div>
        <div class="field"><label>Telefone *</label><input name="patient_phone" value="${appt.patient_phone || ''}" required></div>
        <div class="field"><label>E-mail</label><input name="patient_email" type="email" value="${appt.patient_email || ''}"></div>
        <div class="field"><label>Serviço</label><select name="service_id"><option value="">—</option>${svcOpts}</select></div>
        <div class="field">
          <label>Tipo de atendimento *</label>
          <select name="attendance_type" required>
            <option value="presencial" ${attendance === 'presencial' ? 'selected' : ''}>Presencial</option>
            <option value="online" ${attendance === 'online' ? 'selected' : ''}>Online</option>
          </select>
        </div>
        <div class="field"><label>Data *</label><input name="date" type="date" value="${appt.date || state.selectedDate}" required></div>
        <div class="field"><label>Horário *</label><input name="start_time" type="time" value="${appt.start_time || ''}" required></div>
        <div class="field"><label>Status</label>
          <select name="status">
            ${['pending','confirmed','cancelled'].map((s) => `<option value="${s}" ${appt.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn btn--primary btn--full">Salvar</button>
      </form>
    `;
  }

  async function saveAppt(e, id) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.attendance_type = fd.get('attendance_type') || 'presencial';
    body.service_id = parseServiceId(body.service_id);
    if (body.service_id === null) delete body.service_id;
    try {
      if (id) await api(`/appointments/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/appointments', { method: 'POST', body: JSON.stringify(body) });
      closeModal();
      await render();
    } catch (err) {
      alert(err.message);
    }
  }

  function parseServiceId(value) {
    if (value === undefined || value === null || value === '') return null;
    const id = Number(value);
    return Number.isFinite(id) ? id : null;
  }

  function showApptModal(appt = {}) {
    openModal(apptForm(appt));
    document.getElementById('apptForm').addEventListener('submit', (e) => saveAppt(e, appt.id));
  }

  /* ---- Calendar views ---- */

  async function renderCalendar() {
    const d = state.currentDate;
    const y = d.getFullYear();
    const m = d.getMonth();
    const from = fmtDate(new Date(y, m, 1));
    const to = fmtDate(new Date(y, m + 1, 0));
    await loadAppointments(from, to);

    content.innerHTML = `
      <div class="toolbar">
        <div class="view-tabs">
          <button class="view-tab ${state.calView === 'day' ? 'active' : ''}" data-cal="day">Dia</button>
          <button class="view-tab ${state.calView === 'week' ? 'active' : ''}" data-cal="week">Semana</button>
          <button class="view-tab ${state.calView === 'month' ? 'active' : ''}" data-cal="month">Mês</button>
        </div>
        <button class="btn btn--primary btn--sm" id="btnNewAppt">+ Nova consulta</button>
      </div>
      <div class="card" id="calContainer"></div>
    `;

    content.querySelectorAll('[data-cal]').forEach((btn) => {
      btn.addEventListener('click', () => { state.calView = btn.dataset.cal; renderCalendar(); });
    });
    document.getElementById('btnNewAppt').addEventListener('click', () => showApptModal());

    const container = document.getElementById('calContainer');
    if (state.calView === 'month') container.innerHTML = renderMonth(y, m);
    else if (state.calView === 'week') container.innerHTML = renderWeek();
    else container.innerHTML = renderDay();

    bindCalEvents(container);
  }

  function renderMonth(y, m) {
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startPad = first.getDay();
    const today = fmtDate(new Date());

    let html = `
      <div class="cal-nav">
        <button class="btn btn--outline btn--sm" id="prevMonth">←</button>
        <h2>${MONTHS[m]} ${y}</h2>
        <button class="btn btn--outline btn--sm" id="nextMonth">→</button>
      </div>
      <div class="cal-month">
        ${DAYS.map((d) => `<div class="cal-head">${d}</div>`).join('')}
    `;

    for (let i = 0; i < startPad; i++) html += `<div class="cal-day other"></div>`;

    for (let day = 1; day <= last.getDate(); day++) {
      const dateStr = fmtDate(new Date(y, m, day));
      const appts = apptsForDate(dateStr);
      const cls = [dateStr === today ? 'today' : '', dateStr === state.selectedDate ? 'selected' : ''].filter(Boolean).join(' ');
      html += `
        <div class="cal-day ${cls}" data-date="${dateStr}">
          <div class="num">${day}</div>
          ${appts.length ? `<div class="count">${appts.length} consulta${appts.length > 1 ? 's' : ''}</div>` : ''}
        </div>`;
    }
    html += '</div>';
    return html;
  }

  function renderWeek() {
    const d = new Date(state.currentDate);
    const dow = d.getDay();
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - dow);

    let html = `
      <div class="cal-nav">
        <button class="btn btn--outline btn--sm" id="prevWeek">←</button>
        <h2>Semana de ${fmtBR(fmtDate(weekStart))}</h2>
        <button class="btn btn--outline btn--sm" id="nextWeek">→</button>
      </div>
      <div class="cal-week">
    `;

    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      const dateStr = fmtDate(day);
      const appts = apptsForDate(dateStr);
      html += `
        <div class="cal-week-col">
          <h4>${DAYS[i]} ${day.getDate()}/${day.getMonth() + 1}</h4>
          ${appts.map((a) => `
            <div class="${apptChipClass(a)}" data-appt="${a.id}">
              <strong>${a.start_time}</strong> ${a.patient_name}
              ${a.status === 'cancelled' ? '<em style="font-size:0.65rem">(cancelada)</em> ' : ''}
              <span class="attendance-tag attendance-tag--${a.attendance_type || 'presencial'}">${attendanceLabel(a.attendance_type)}</span>
            </div>
          `).join('') || '<span style="font-size:0.75rem;color:#999">—</span>'}
        </div>`;
    }
    html += '</div>';
    return html;
  }

  function renderDay() {
    const dateStr = state.selectedDate;
    const appts = apptsForDate(dateStr);
    const [y, mo, d] = dateStr.split('-').map(Number);
    const dayName = DAY_FULL[new Date(y, mo - 1, d).getDay()];

    return `
      <div class="cal-nav">
        <button class="btn btn--outline btn--sm" id="prevDay">←</button>
        <h2>${dayName}, ${fmtBR(dateStr)}</h2>
        <button class="btn btn--outline btn--sm" id="nextDay">→</button>
      </div>
      <div class="cal-day-view">
        ${appts.length ? appts.map((a) => `
          <div class="card ${apptChipClass(a)}" data-appt="${a.id}" style="cursor:pointer">
            <strong>${a.start_time} – ${a.end_time}</strong> · ${a.patient_name}
            <span class="attendance-tag attendance-tag--${a.attendance_type || 'presencial'}">${attendanceLabel(a.attendance_type)}</span><br>
            <small>${a.patient_phone} ${a.service_name ? '· ' + a.service_name : ''}</small>
            <span class="status status-${a.status}">${statusLabel(a.status)}</span>
          </div>
        `).join('') : '<div class="empty">Nenhuma consulta neste dia</div>'}
      </div>
    `;
  }

  function bindCalEvents(container) {
    container.querySelector('#prevMonth')?.addEventListener('click', () => {
      state.currentDate.setMonth(state.currentDate.getMonth() - 1);
      renderCalendar();
    });
    container.querySelector('#nextMonth')?.addEventListener('click', () => {
      state.currentDate.setMonth(state.currentDate.getMonth() + 1);
      renderCalendar();
    });
    container.querySelector('#prevWeek')?.addEventListener('click', () => {
      state.currentDate.setDate(state.currentDate.getDate() - 7);
      renderCalendar();
    });
    container.querySelector('#nextWeek')?.addEventListener('click', () => {
      state.currentDate.setDate(state.currentDate.getDate() + 7);
      renderCalendar();
    });
    container.querySelector('#prevDay')?.addEventListener('click', () => {
      const d = new Date(state.selectedDate + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      state.selectedDate = fmtDate(d);
      renderCalendar();
    });
    container.querySelector('#nextDay')?.addEventListener('click', () => {
      const d = new Date(state.selectedDate + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      state.selectedDate = fmtDate(d);
      renderCalendar();
    });

    container.querySelectorAll('.cal-day[data-date]').forEach((el) => {
      el.addEventListener('click', () => {
        state.selectedDate = el.dataset.date;
        state.calView = 'day';
        renderCalendar();
      });
    });

    container.querySelectorAll('[data-appt]').forEach((el) => {
      el.addEventListener('click', () => {
        const appt = state.appointments.find((a) => a.id === Number(el.dataset.appt));
        if (appt) showApptDetail(appt);
      });
    });
  }

  function showApptDetail(appt) {
    openModal(`
      <h3>${appt.patient_name}</h3>
      <p><strong>Data:</strong> ${fmtBR(appt.date)} às ${appt.start_time}<br>
      <strong>Atendimento:</strong> ${attendanceLabel(appt.attendance_type)}<br>
      <strong>Telefone:</strong> ${appt.patient_phone}<br>
      ${appt.patient_email ? `<strong>E-mail:</strong> ${appt.patient_email}<br>` : ''}
      ${appt.service_name ? `<strong>Serviço:</strong> ${appt.service_name}<br>` : ''}
      <span class="status status-${appt.status}">${statusLabel(appt.status)}</span></p>
      <div class="actions" style="margin-top:16px">
        <button class="btn btn--outline btn--sm" id="editAppt">Editar</button>
        ${appt.status !== 'cancelled' ? `<button class="btn btn--outline btn--sm btn--warn" id="cancelAppt">Cancelar consulta</button>` : ''}
        <button class="btn btn--danger btn--sm" id="deleteAppt">Excluir</button>
      </div>
    `);
    document.getElementById('editAppt').addEventListener('click', () => { closeModal(); showApptModal(appt); });
    document.getElementById('cancelAppt')?.addEventListener('click', async () => {
      if (!confirm('Cancelar esta consulta? O registro será mantido para controle de pagamentos.')) return;
      await api(`/appointments/${appt.id}/cancel`, { method: 'POST' });
      closeModal();
      render();
    });
    document.getElementById('deleteAppt').addEventListener('click', async () => {
      if (!confirm('Excluir permanentemente esta consulta? Esta ação não pode ser desfeita.')) return;
      await api(`/appointments/${appt.id}`, { method: 'DELETE' });
      closeModal();
      render();
    });
  }

  /* ---- Appointments list ---- */

  async function renderAppointments() {
    const from = fmtDate(new Date(Date.now() - 30 * 86400000));
    const to = fmtDate(new Date(Date.now() + 90 * 86400000));
    await loadAppointments(from, to);

    const rows = [...state.appointments].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      return d !== 0 ? d : a.start_time.localeCompare(b.start_time);
    });

    content.innerHTML = `
      <div class="toolbar">
        <h2 style="flex:1;color:var(--purple-dark)">Consultas</h2>
        <button class="btn btn--primary btn--sm" id="btnNewAppt">+ Nova consulta</button>
      </div>
      <div class="card table-wrap">
        ${rows.length ? `<table>
          <thead><tr><th>Data</th><th>Horário</th><th>Paciente</th><th>Atendimento</th><th>Contato</th><th>Serviço</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((a) => `
            <tr class="${a.status === 'cancelled' ? 'row-cancelled' : ''}">
              <td>${fmtBR(a.date)}</td>
              <td>${a.start_time}</td>
              <td>${a.patient_name}</td>
              <td><span class="attendance-tag attendance-tag--${a.attendance_type || 'presencial'}">${attendanceLabel(a.attendance_type)}</span></td>
              <td>${a.patient_phone}</td>
              <td>${a.service_name || '—'}</td>
              <td><span class="status status-${a.status}">${statusLabel(a.status)}</span></td>
              <td class="actions">
                <button class="btn btn--outline btn--sm" data-edit="${a.id}">Editar</button>
                ${a.status !== 'cancelled' ? `<button class="btn btn--outline btn--sm btn--warn" data-cancel="${a.id}">Cancelar</button>` : ''}
                <button class="btn btn--danger btn--sm" data-delete="${a.id}">Excluir</button>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>` : '<div class="empty">Nenhuma consulta encontrada</div>'}
      </div>
    `;

    document.getElementById('btnNewAppt').addEventListener('click', () => showApptModal());
    content.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = state.appointments.find((x) => x.id === Number(btn.dataset.edit));
        showApptModal(a);
      });
    });
    content.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancelar esta consulta? O registro será mantido para controle de pagamentos.')) return;
        await api(`/appointments/${btn.dataset.cancel}/cancel`, { method: 'POST' });
        renderAppointments();
      });
    });
    content.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir permanentemente esta consulta? Esta ação não pode ser desfeita.')) return;
        await api(`/appointments/${btn.dataset.delete}`, { method: 'DELETE' });
        renderAppointments();
      });
    });
  }

  /* ---- Waiting list ---- */

  async function renderWaiting() {
    state.waitingList = await api('/waiting-list');

    content.innerHTML = `
      <div class="toolbar"><h2 style="color:var(--purple-dark)">Lista de espera</h2></div>
      <div class="card table-wrap">
        ${state.waitingList.length ? `<table>
          <thead><tr><th>Nome</th><th>Contato</th><th>Preferência</th><th>Obs.</th><th>Status</th><th></th></tr></thead>
          <tbody>${state.waitingList.map((w) => `
            <tr>
              <td>${w.name}</td>
              <td>${w.phone}${w.email ? '<br><small>' + w.email + '</small>' : ''}</td>
              <td>${[w.preferred_day, w.preferred_time].filter(Boolean).join(' · ') || '—'}</td>
              <td>${w.note || '—'}</td>
              <td><span class="status status-${w.status}">${statusLabel(w.status)}</span></td>
              <td>
                <select data-wl="${w.id}" class="wl-status">
                  ${['waiting','contacted','scheduled','cancelled'].map((s) =>
                    `<option value="${s}" ${w.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`
                  ).join('')}
                </select>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>` : '<div class="empty">Nenhuma solicitação na lista de espera</div>'}
      </div>
    `;

    content.querySelectorAll('.wl-status').forEach((sel) => {
      sel.addEventListener('change', async () => {
        await api(`/waiting-list/${sel.dataset.wl}`, {
          method: 'PUT',
          body: JSON.stringify({ status: sel.value }),
        });
      });
    });
  }

  /* ---- Settings ---- */

  async function renderSettings() {
    const [hours, breaks, unavail, blocked] = await Promise.all([
      api('/working-hours'),
      api('/breaks'),
      api('/unavailable-dates'),
      api('/blocked-slots'),
    ]);

    content.innerHTML = `
      <h2 style="color:var(--purple-dark);margin-bottom:20px">Configurações</h2>
      <div class="settings-grid">
        <div class="card">
          <h2>Sessão</h2>
          <form id="settingsForm">
            <div class="field"><label>Duração (min)</label><input name="session_duration_minutes" type="number" value="${state.settings.session_duration_minutes}"></div>
            <div class="field"><label>Intervalo entre sessões (min)</label><input name="buffer_minutes" type="number" value="${state.settings.buffer_minutes}"></div>
            <div class="field"><label>E-mail para notificações</label><input name="notify_email" type="email" value="${state.settings.notify_email || ''}"></div>
            <button type="submit" class="btn btn--primary">Salvar</button>
          </form>
        </div>
        <div class="card">
          <h2>Horários de trabalho</h2>
          <form id="hoursForm">
            ${hours.map((h) => `
              <div class="wh-row">
                <span>${DAY_FULL[h.day_of_week]}</span>
                <input name="start_${h.day_of_week}" type="time" value="${h.start_time}">
                <input name="end_${h.day_of_week}" type="time" value="${h.end_time}">
                <label><input type="checkbox" name="enabled_${h.day_of_week}" ${h.enabled ? 'checked' : ''}></label>
              </div>
            `).join('')}
            <button type="submit" class="btn btn--primary" style="margin-top:12px">Salvar horários</button>
          </form>
        </div>
      </div>

      <div class="settings-grid">
        <div class="card">
          <h2>Pausas / intervalos</h2>
          <form id="breakForm">
            <div class="field"><label>Dia (opcional)</label>
              <select name="day_of_week"><option value="">Todos os dias</option>
                ${DAY_FULL.map((d, i) => `<option value="${i}">${d}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Início</label><input name="start_time" type="time" required></div>
            <div class="field"><label>Fim</label><input name="end_time" type="time" required></div>
            <button type="submit" class="btn btn--primary btn--sm">Adicionar pausa</button>
          </form>
          ${breaks.length ? `<ul style="margin-top:16px;font-size:0.85rem">${breaks.map((b) => `
            <li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
              ${b.day_of_week != null ? DAY_FULL[b.day_of_week] : 'Todos'}: ${b.start_time}–${b.end_time}
              <button class="btn btn--danger btn--sm" data-del-break="${b.id}">×</button>
            </li>
          `).join('')}</ul>` : ''}
        </div>
        <div class="card">
          <h2>Datas indisponíveis</h2>
          <form id="unavailForm">
            <div class="field"><label>Data</label><input name="date" type="date" required></div>
            <div class="field"><label>Motivo</label><input name="reason" placeholder="Férias, feriado..."></div>
            <button type="submit" class="btn btn--primary btn--sm">Bloquear data</button>
          </form>
          ${unavail.length ? `<ul style="margin-top:16px;font-size:0.85rem">${unavail.map((u) => `
            <li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
              ${fmtBR(u.date)} ${u.reason ? '— ' + u.reason : ''}
              <button class="btn btn--danger btn--sm" data-del-unavail="${u.id}">×</button>
            </li>
          `).join('')}</ul>` : ''}
        </div>
      </div>

      <div class="card">
        <h2>Bloquear horário específico</h2>
        <form id="blockForm" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end">
          <div class="field" style="margin:0"><label>Data</label><input name="date" type="date" required></div>
          <div class="field" style="margin:0"><label>Início</label><input name="start_time" type="time" required></div>
          <div class="field" style="margin:0"><label>Motivo</label><input name="reason"></div>
          <button type="submit" class="btn btn--primary btn--sm">Bloquear</button>
        </form>
        ${blocked.length ? `<ul style="margin-top:16px;font-size:0.85rem">${blocked.slice(0, 20).map((b) => `
          <li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            ${fmtBR(b.date)} ${b.start_time} ${b.reason ? '— ' + b.reason : ''}
            <button class="btn btn--danger btn--sm" data-del-block="${b.id}">×</button>
          </li>
        `).join('')}</ul>` : ''}
      </div>
    `;

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.settings = await api('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          session_duration_minutes: Number(fd.get('session_duration_minutes')),
          buffer_minutes: Number(fd.get('buffer_minutes')),
          notify_email: fd.get('notify_email'),
        }),
      });
      alert('Salvo!');
    });

    document.getElementById('hoursForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const hoursData = DAY_FULL.map((_, i) => ({
        day_of_week: i,
        start_time: fd.get(`start_${i}`),
        end_time: fd.get(`end_${i}`),
        enabled: fd.has(`enabled_${i}`),
      }));
      await api('/working-hours', { method: 'PUT', body: JSON.stringify({ hours: hoursData }) });
      alert('Horários salvos!');
    });

    document.getElementById('breakForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        start_time: fd.get('start_time'),
        end_time: fd.get('end_time'),
      };
      const day = fd.get('day_of_week');
      if (day !== '') body.day_of_week = Number(day);
      await api('/breaks', { method: 'POST', body: JSON.stringify(body) });
      renderSettings();
    });

    document.getElementById('unavailForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api('/unavailable-dates', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
      renderSettings();
    });

    document.getElementById('blockForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api('/blocked-slots', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
      renderSettings();
    });

    content.querySelectorAll('[data-del-break]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/breaks/${btn.dataset.delBreak}`, { method: 'DELETE' });
        renderSettings();
      });
    });
    content.querySelectorAll('[data-del-unavail]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/unavailable-dates/${btn.dataset.delUnavail}`, { method: 'DELETE' });
        renderSettings();
      });
    });
    content.querySelectorAll('[data-del-block]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/blocked-slots/${btn.dataset.delBlock}`, { method: 'DELETE' });
        renderSettings();
      });
    });
  }

  /* ---- Navigation ---- */

  async function render() {
    if (state.view === 'calendar') await renderCalendar();
    else if (state.view === 'appointments') await renderAppointments();
    else if (state.view === 'waiting') await renderWaiting();
    else if (state.view === 'settings') await renderSettings();
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.dataset.view;
      document.getElementById('sidebar').classList.remove('open');
      render();
    });
  });

  btnLock.addEventListener('click', async () => {
    const locked = state.settings?.schedule_locked;
    const msg = locked
      ? 'Abrir agenda para novos agendamentos?'
      : 'Fechar agenda? Visitantes verão apenas a lista de espera.';
    if (!confirm(msg)) return;
    if (locked) await api('/schedule/unlock', { method: 'POST' });
    else await api('/schedule/lock', { method: 'POST' });
    await loadSettings();
  });

  document.getElementById('btnLogout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });

  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  async function init() {
    try {
      const me = await api('/me');
      document.getElementById('adminUser').textContent = me.username;
      state.services = await api('/services');
      await loadSettings();
      render();
    } catch {
      window.location.href = '/admin/login';
    }
  }

  init();
})();
