/** Dados do consultório usados em confirmações e e-mails. */
export const PRACTICE = {
  psychologistName: 'Renata Batista',
  practiceName: 'Renata Batista — Psicologia & Arteterapia',
  crp: 'CRP 06/145801',
  phoneDisplay: '(11) 99278-9380',
  phoneE164: '5511992789380',
  email: 'renatabatistapsicologa@gmail.com',
  address: 'R. Dr. Aureliano Barreiros, 641 — Itaquera, São Paulo — SP, 08210-450',
  addressHtml: 'R. Dr. Aureliano Barreiros, 641<br>Itaquera, São Paulo — SP, 08210-450',
  hours: 'Segunda a sábado, 8h às 20h',
};

export function getOnlineMeetingLink() {
  return (process.env.ONLINE_MEETING_LINK || '').trim() || null;
}
