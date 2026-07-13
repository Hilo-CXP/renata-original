(() => {
  const panel = document.getElementById('bookingPanel');
  const loader = document.getElementById('bookingLoader');

  const state = {
    step: 1,
    locked: false,
    services: [],
    serviceId: null,
    date: '',
    slot: null,
  };

  const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  async function api(path, options = {}) {
    const res = await fetch(`/api/public${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro na requisição');
    return data;
  }

  function formatDateBR(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  function minDate() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function renderSteps() {
    const labels = ['Serviço', 'Data', 'Horário', 'Dados', 'Confirmar'];
    return `<div class="booking__steps">${labels.map((l, i) => {
      const n = i + 1;
      const cls = n === state.step ? 'active' : n < state.step ? 'done' : '';
      return `<div class="booking__step ${cls}">${n}. ${l}</div>`;
    }).join('')}</div>`;
  }

  function renderLocked() {
    panel.innerHTML = `
      <div class="booking__locked">
        <div class="booking__locked-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h3>Agenda temporariamente fechada</h3>
        <p>No momento não há horários disponíveis. Entre na lista de espera e avisaremos quando abrirmos novas vagas.</p>
      </div>
      ${renderWaitingListForm()}
    `;
    bindWaitingListForm();
  }

  function renderWaitingListForm() {
    return `
      <form id="waitingListForm">
        <div class="booking__field">
          <label class="booking__label" for="wl-name">Nome completo *</label>
          <input type="text" id="wl-name" required placeholder="Seu nome">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-phone">Telefone / WhatsApp *</label>
          <input type="tel" id="wl-phone" required placeholder="(11) 99999-9999">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-email">E-mail</label>
          <input type="email" id="wl-email" placeholder="seu@email.com">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-day">Dia preferido</label>
          <select id="wl-day">
            <option value="">Qualquer dia</option>
            ${DAY_NAMES.map((d, i) => `<option value="${d}">${d}-feira</option>`).join('')}
          </select>
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-time">Horário preferido</label>
          <select id="wl-time">
            <option value="">Qualquer horário</option>
            <option value="manhã">Manhã (8h–12h)</option>
            <option value="tarde">Tarde (12h–18h)</option>
            <option value="noite">Noite (18h–20h)</option>
          </select>
        </div>
        <div class="booking__field">
          <label class="booking__label" for="wl-note">Observação (opcional)</label>
          <textarea id="wl-note" rows="3" placeholder="Alguma preferência ou informação adicional"></textarea>
        </div>
        <button type="submit" class="btn btn--primary btn--full">Entrar na lista de espera</button>
        <p class="booking__message" id="wlFeedback" role="status"></p>
      </form>
    `;
  }

  function bindWaitingListForm() {
    const form = document.getElementById('waitingListForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fb = document.getElementById('wlFeedback');
      fb.className = 'booking__message';
      try {
        const data = await api('/waiting-list', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('wl-name').value,
            phone: document.getElementById('wl-phone').value,
            email: document.getElementById('wl-email').value,
            preferred_day: document.getElementById('wl-day').value,
            preferred_time: document.getElementById('wl-time').value,
            note: document.getElementById('wl-note').value,
          }),
        });
        fb.textContent = data.message;
        fb.classList.add('success');
        form.reset();
      } catch (err) {
        fb.textContent = err.message;
        fb.classList.add('error');
      }
    });
  }

  function renderStep1() {
    panel.innerHTML = `
      ${renderSteps()}
      <label class="booking__label">Selecione o serviço</label>
      <div class="booking__services">
        ${state.services.map((s) => `
          <button type="button" class="booking__service ${state.serviceId === s.id ? 'selected' : ''}" data-id="${s.id}">
            <div>
              <strong>${s.name}</strong>
              <span>${s.duration_minutes || 50} min</span>
            </div>
          </button>
        `).join('')}
      </div>
      <div class="booking__actions">
        <button type="button" class="btn btn--primary" id="btnNext1" ${!state.serviceId ? 'disabled' : ''}>Continuar</button>
      </div>
    `;

    panel.querySelectorAll('.booking__service').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.serviceId = Number(btn.dataset.id);
        renderStep1();
      });
    });
    document.getElementById('btnNext1')?.addEventListener('click', () => {
      state.step = 2;
      render();
    });
  }

  function renderStep2() {
    panel.innerHTML = `
      ${renderSteps()}
      <label class="booking__label" for="bookDate">Escolha a data</label>
      <input type="date" id="bookDate" class="booking__date-input" min="${minDate()}" value="${state.date}">
      <div class="booking__actions">
        <button type="button" class="btn btn--outline" id="btnBack2">Voltar</button>
        <button type="button" class="btn btn--primary" id="btnNext2">Continuar</button>
      </div>
    `;

    document.getElementById('bookDate').addEventListener('change', (e) => {
      state.date = e.target.value;
      state.slot = null;
    });
    document.getElementById('btnBack2').addEventListener('click', () => { state.step = 1; render(); });
    document.getElementById('btnNext2').addEventListener('click', () => {
      state.date = document.getElementById('bookDate').value;
      if (!state.date) return alert('Selecione uma data.');
      state.step = 3;
      render();
    });
  }

  async function renderStep3() {
    panel.innerHTML = `${renderSteps()}<div class="booking__loader">Buscando horários...</div>`;

    try {
      const { locked, slots } = await api(`/slots?date=${state.date}`);
      if (locked) {
        state.locked = true;
        renderLocked();
        return;
      }

      if (!slots.length) {
        panel.innerHTML = `
          ${renderSteps()}
          <div class="booking__empty">Nenhum horário disponível nesta data. Tente outro dia.</div>
          <div class="booking__actions">
            <button type="button" class="btn btn--outline" id="btnBack3">Voltar</button>
          </div>
        `;
        document.getElementById('btnBack3').addEventListener('click', () => { state.step = 2; render(); });
        return;
      }

      panel.innerHTML = `
        ${renderSteps()}
        <label class="booking__label">Horários disponíveis — ${formatDateBR(state.date)}</label>
        <div class="booking__slots">
          ${slots.map((s) => `
            <button type="button" class="booking__slot ${state.slot === s.start_time ? 'selected' : ''}" data-time="${s.start_time}">
              ${s.start_time}
            </button>
          `).join('')}
        </div>
        <div class="booking__actions">
          <button type="button" class="btn btn--outline" id="btnBack3">Voltar</button>
          <button type="button" class="btn btn--primary" id="btnNext3" ${!state.slot ? 'disabled' : ''}>Continuar</button>
        </div>
      `;

      panel.querySelectorAll('.booking__slot').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.slot = btn.dataset.time;
          renderStep3();
        });
      });
      document.getElementById('btnBack3').addEventListener('click', () => { state.step = 2; render(); });
      document.getElementById('btnNext3')?.addEventListener('click', () => {
        state.step = 4;
        render();
      });
    } catch (err) {
      panel.innerHTML = `${renderSteps()}<div class="booking__message error">${err.message}</div>`;
    }
  }

  function renderStep4() {
    const service = state.services.find((s) => s.id === state.serviceId);
    panel.innerHTML = `
      ${renderSteps()}
      <div class="booking__summary">
        <strong>${service?.name || 'Consulta'}</strong><br>
        ${formatDateBR(state.date)} às ${state.slot}
      </div>
      <form id="patientForm">
        <div class="booking__field">
          <label class="booking__label" for="p-name">Nome completo *</label>
          <input type="text" id="p-name" required placeholder="Seu nome">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="p-phone">Telefone / WhatsApp *</label>
          <input type="tel" id="p-phone" required placeholder="(11) 99999-9999">
        </div>
        <div class="booking__field">
          <label class="booking__label" for="p-email">E-mail</label>
          <input type="email" id="p-email" placeholder="seu@email.com">
        </div>
        <div class="booking__actions">
          <button type="button" class="btn btn--outline" id="btnBack4">Voltar</button>
          <button type="submit" class="btn btn--primary">Revisar agendamento</button>
        </div>
      </form>
    `;

    document.getElementById('btnBack4').addEventListener('click', () => { state.step = 3; render(); });
    document.getElementById('patientForm').addEventListener('submit', (e) => {
      e.preventDefault();
      state.patient = {
        name: document.getElementById('p-name').value,
        phone: document.getElementById('p-phone').value,
        email: document.getElementById('p-email').value,
      };
      state.step = 5;
      render();
    });
  }

  function renderStep5() {
    const service = state.services.find((s) => s.id === state.serviceId);
    panel.innerHTML = `
      ${renderSteps()}
      <div class="booking__summary">
        <strong>Confirme seus dados</strong><br><br>
        Serviço: ${service?.name}<br>
        Data: ${formatDateBR(state.date)}<br>
        Horário: ${state.slot}<br>
        Nome: ${state.patient.name}<br>
        Telefone: ${state.patient.phone}<br>
        ${state.patient.email ? `E-mail: ${state.patient.email}<br>` : ''}
      </div>
      <div class="booking__actions">
        <button type="button" class="btn btn--outline" id="btnBack5">Voltar</button>
        <button type="button" class="btn btn--primary" id="btnConfirm">Confirmar agendamento</button>
      </div>
      <p class="booking__message" id="bookFeedback" role="status"></p>
    `;

    document.getElementById('btnBack5').addEventListener('click', () => { state.step = 4; render(); });
    document.getElementById('btnConfirm').addEventListener('click', confirmBooking);
  }

  async function confirmBooking() {
    const fb = document.getElementById('bookFeedback');
    const btn = document.getElementById('btnConfirm');
    btn.disabled = true;
    fb.className = 'booking__message';

    try {
      const data = await api('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          service_id: state.serviceId,
          date: state.date,
          start_time: state.slot,
          patient_name: state.patient.name,
          patient_phone: state.patient.phone,
          patient_email: state.patient.email,
        }),
      });
      fb.textContent = data.message;
      fb.classList.add('success');
      panel.querySelector('.booking__actions')?.remove();
    } catch (err) {
      fb.textContent = err.message;
      fb.classList.add('error');
      btn.disabled = false;
      if (err.message.includes('indisponível') || err.message.includes('reservado')) {
        setTimeout(() => { state.step = 3; render(); }, 2000);
      }
    }
  }

  function render() {
    if (state.locked) return renderLocked();
    switch (state.step) {
      case 1: renderStep1(); break;
      case 2: renderStep2(); break;
      case 3: renderStep3(); break;
      case 4: renderStep4(); break;
      case 5: renderStep5(); break;
      default: renderStep1();
    }
  }

  async function init() {
    try {
      const [settings, services] = await Promise.all([
        api('/settings'),
        api('/services'),
      ]);
      state.locked = settings.schedule_locked;
      state.services = services;
      if (state.services.length === 1) state.serviceId = state.services[0].id;
      loader?.remove();
      if (state.locked) renderLocked();
      else render();
    } catch {
      const isLocalFile = window.location.protocol === 'file:';
      const wrongPort = window.location.port && window.location.port !== '3000';
      loader.innerHTML = `
        <div class="booking__offline">
          <p><strong>Não foi possível carregar a agenda.</strong></p>
          ${isLocalFile || wrongPort ? `
            <p>O agendamento online só funciona com o <strong>servidor ativo</strong>, não pelo Live Server.</p>
            <ol>
              <li>Dê duplo clique em <strong>iniciar.bat</strong> na pasta do projeto</li>
              <li>Deixe a janela aberta</li>
              <li>Acesse <a href="http://localhost:3000/#agendar">http://localhost:3000/#agendar</a></li>
            </ol>
          ` : `
            <p>Verifique se o <strong>iniciar.bat</strong> está rodando e recarregue a página.</p>
            <p><a href="http://localhost:3000/#agendar">http://localhost:3000/#agendar</a></p>
          `}
        </div>
      `;
    }
  }

  init();
})();
