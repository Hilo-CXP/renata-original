/**
 * Camada de compatibilidade — preferir server/services/* para novos usos.
 */
export { sendEmail } from './services/emailService.js';
export { sendWhatsApp } from './services/messagingService.js';
export {
  notifyClinicNewBooking as notifyNewBooking,
  notifyClinicCancellation as notifyCancellation,
  notifyClinicWaitingList as notifyWaitingList,
  sendClientConfirmations,
  sendClientReminder,
} from './services/confirmationService.js';
