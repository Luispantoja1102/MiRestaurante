import axios from 'axios';
import { authStore, clearSession } from './authStore';

const envUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL;
const publicUrl =
  envUrl ||
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8081/'
    : '/api/');

axios.defaults.baseURL = publicUrl;
axios.defaults.headers.common['Content-Type'] = 'application/json';

axios.interceptors.request.use((config) => {
  const token = authStore.token;
  if (token) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

axios.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      clearSession();
      if (
        typeof window !== 'undefined' &&
        !window.location.pathname.match(/^\/($|register|invite|forgot|reset)/)
      ) {
        window.location.href = '/login';
      }
    }
    if (
      error.response?.status === 403 &&
      error.response?.data?.code === 'SUBSCRIPTION_REQUIRED' &&
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/billing') &&
      !window.location.pathname.startsWith('/platform')
    ) {
      window.location.href = '/billing';
    }
    return Promise.reject(error);
  }
);

export const apiClient = axios;

export const apiService = {
  login(data: string, password: string) {
    return axios.post('/usuarios/login', { data, password }).then((r) => r.data);
  },
  register(payload: Record<string, unknown>) {
    return axios.post('/usuarios/register', payload).then((r) => r.data);
  },
  forgotPassword(email: string) {
    return axios.post('/usuarios/forgot-password', { email }).then((r) => r.data);
  },
  resetPassword(token: string, password: string) {
    return axios.post('/usuarios/reset-password', { token, password }).then((r) => r.data);
  },
  me() {
    return axios.get('/usuarios/me').then((r) => r.data);
  },

  getAllFoods() {
    return axios.get('/foods').then((r) => r.data);
  },
  getFoodById(foodId: string) {
    return axios.get(`/foods/${foodId}`).then((r) => r.data);
  },
  createFood(foodDTO: {
    name: string;
    price: number;
    description?: string;
    imgUrl?: string;
    menuId: string;
  }) {
    return axios.post('/foods', foodDTO).then((r) => r.data);
  },
  editFood(foodId: string, foodDTO: Record<string, unknown>) {
    return axios.put(`/foods/${foodId}`, foodDTO).then((r) => r.data);
  },
  deleteFood(foodId: string) {
    return axios.delete(`/foods/${foodId}`).then((r) => r.status === 200);
  },

  getAllMenus() {
    return axios.get('/menus').then((r) => r.data);
  },
  getMenuById(menuId: string) {
    return axios.get(`/menus/${menuId}`).then((r) => r.data);
  },
  createMenu(menuDTO: { name: string; description?: string }) {
    return axios.post('/menus', menuDTO).then((r) => r.data);
  },
  editMenu(menuId: string, menuDTO: Record<string, unknown>) {
    return axios.put(`/menus/${menuId}`, menuDTO).then((r) => r.data);
  },
  deleteMenu(menuId: string) {
    return axios.delete(`/menus/${menuId}`).then((r) => r.status === 200);
  },

  counterSale(data: Record<string, unknown>) {
    return axios.post('/orders/counter', data).then((r) => r.data);
  },
  getIngredients() {
    return axios.get('/ingredients').then((r) => r.data);
  },
  createIngredient(data: Record<string, unknown>) {
    return axios.post('/ingredients', data).then((r) => r.data);
  },
  updateIngredient(id: string, data: Record<string, unknown>) {
    return axios.put(`/ingredients/${id}`, data).then((r) => r.data);
  },
  deleteIngredient(id: string) {
    return axios.delete(`/ingredients/${id}`).then((r) => r.data);
  },
  stockMovement(id: string, data: { type: string; quantity: number; note?: string }) {
    return axios.post(`/ingredients/${id}/stock`, data).then((r) => r.data);
  },
  getStockMovements(params: { ingredientId?: string; limit?: number } = {}) {
    return axios.get('/ingredients/movements', { params }).then((r) => r.data);
  },
  getSync() {
    return axios.get('/sync').then((r) => r.data);
  },
  getOrders() {
    return axios.get('/orders').then((r) => r.data);
  },
  getAwaitingOrders() {
    return axios.get('/orders/awaiting').then((r) => r.data);
  },
  getOrdersById(orderId: string) {
    return axios.get(`/orders/${orderId}`).then((r) => r.data);
  },
  createOrder(orderDTO: Record<string, unknown>) {
    return axios.post('/orders', orderDTO).then((r) => r.data);
  },
  updateOrderStatus(orderId: string, status: string) {
    return axios.put(`/orders/${orderId}/status`, { status }).then((r) => r.data);
  },
  payOrder(orderId: string, paymentMethod: string, pointChargeId?: string) {
    return axios.put(`/orders/${orderId}/pay`, { paymentMethod, pointChargeId }).then((r) => r.data);
  },
  editOrderAsCompleted(orderId: string) {
    return this.updateOrderStatus(orderId, 'served');
  },
  deleteOrder(_orderId: string) {
    return Promise.resolve(false);
  },

  getTables() {
    return axios.get('/tables').then((r) => r.data);
  },
  getTableById(tableId: string) {
    return axios.get(`/tables/${tableId}`).then((r) => r.data);
  },
  createTable(tableDTO: Record<string, unknown>) {
    return axios.post('/tables', tableDTO).then((r) => r.data);
  },
  editTable(tableId: string, tableDTO: Record<string, unknown>) {
    return axios.put(`/tables/${tableId}`, tableDTO).then((r) => r.data);
  },
  deleteTable(tableId: string) {
    return axios.delete(`/tables/${tableId}`).then((r) => r.status === 200);
  },

  getWaiters() {
    return axios.get('/waiters').then((r) => r.data);
  },
  createWaiter(waiterDTO: Record<string, unknown>) {
    return axios.post('/waiters/add', waiterDTO).then((r) => r.data);
  },
  updateWaiter(cellphone: string, waiterDTO: Record<string, unknown>) {
    return axios.put(`/waiters/${cellphone}`, waiterDTO).then((r) => r.data);
  },
  deleteWaiter(cellphone: string) {
    return axios.delete(`/waiters/${cellphone}`).then((r) => r.data);
  },

  getWaitlist() {
    return axios.get('/usuarios/waitlist/').then((r) => r.data);
  },
  addWaitlist(data: { nombre: string; telefono: string | number }) {
    return axios.post('/usuarios/waitlist/add', data).then((r) => r.data);
  },
  deleteWaitlist(id: string | number) {
    return axios.delete(`/usuarios/waitlist/delete/${id}`).then((r) => r.data);
  },

  getSettings() {
    return axios.get('/settings').then((r) => r.data);
  },
  saveSettings(settingsDTO: Record<string, unknown>) {
    return axios.post('/settings', settingsDTO).then((r) => r.data);
  },

  getTeam() {
    return axios.get('/team').then((r) => r.data);
  },
  createTeamMember(data: Record<string, unknown>) {
    return axios.post('/team', data).then((r) => r.data);
  },
  changeTeamRole(id: string, role: string) {
    return axios.put(`/team/${id}/role`, { role }).then((r) => r.data);
  },
  resetTeamPassword(id: string, password: string) {
    return axios.put(`/team/${id}/password`, { password }).then((r) => r.data);
  },
  deleteTeamMember(id: string) {
    return axios.delete(`/team/${id}`).then((r) => r.data);
  },
  getInvites() {
    return axios.get('/invites').then((r) => r.data);
  },
  createInvite(data: { email: string; role: string }) {
    return axios.post('/invites', data).then((r) => r.data);
  },
  revokeInvite(id: string) {
    return axios.put(`/invites/${id}/revoke`).then((r) => r.data);
  },
  deleteInvite(id: string) {
    return axios.delete(`/invites/${id}`).then((r) => r.data);
  },
  getInviteByToken(token: string) {
    return axios.get(`/invites/token/${token}`).then((r) => r.data);
  },
  acceptInvite(payload: Record<string, unknown>) {
    return axios.post('/invites/accept', payload).then((r) => r.data);
  },

  getCashSession() {
    return axios.get('/cash/session').then((r) => r.data);
  },
  openCashSession(openingFloat: number) {
    return axios.post('/cash/session/open', { openingFloat }).then((r) => r.data);
  },
  closeCashSession(countedCash: number, notes = '') {
    return axios.post('/cash/session/close', { countedCash, notes }).then((r) => r.data);
  },
  getCashSessionById(id: string) {
    return axios.get(`/cash/session/${id}`).then((r) => r.data);
  },

  getBillingPlans() {
    return axios.get('/billing/plans').then((r) => r.data);
  },
  getBillingStatus() {
    return axios.get('/billing/status').then((r) => r.data);
  },
  billingCheckout(plan: string, email?: string) {
    return axios.post('/billing/checkout', { plan, email }).then((r) => r.data);
  },
  billingDevActivate(plan: string, preapprovalId?: string) {
    return axios
      .post('/billing/dev/activate', { plan, preapprovalId })
      .then((r) => r.data);
  },

  platformListTenants() {
    return axios.get('/platform/tenants').then((r) => r.data);
  },
  platformSuspendTenant(id: string, reason: string) {
    return axios.post(`/platform/tenants/${id}/suspend`, { reason }).then((r) => r.data);
  },
  platformReactivateTenant(id: string, mode: 'active' | 'trial' = 'active') {
    return axios.post(`/platform/tenants/${id}/reactivate`, { mode }).then((r) => r.data);
  },
  platformSetPlan(id: string, plan: string) {
    return axios.patch(`/platform/tenants/${id}/plan`, { plan }).then((r) => r.data);
  },
  platformOverview() {
    return axios.get('/platform/overview').then((r) => r.data);
  },
  platformGetTenant(id: string) {
    return axios.get(`/platform/tenants/${id}`).then((r) => r.data);
  },
  platformUpdateTenant(id: string, data: Record<string, unknown>) {
    return axios.patch(`/platform/tenants/${id}`, data).then((r) => r.data);
  },
  platformTenantActivity(id: string) {
    return axios.get(`/platform/tenants/${id}/activity`).then((r) => r.data);
  },
  platformActivity(limit = 60) {
    return axios.get('/platform/activity', { params: { limit } }).then((r) => r.data);
  },
  platformFinance(month?: string) {
    return axios.get('/platform/finance', { params: month ? { month } : {} }).then((r) => r.data);
  },
  platformFinanceCsv(month: string) {
    return axios.get('/platform/finance', { params: { month, format: 'csv' }, responseType: 'blob' }).then((r) => r.data as Blob);
  },
  platformCreateExpense(data: { label: string; amount: number; note?: string }) {
    return axios.post('/platform/expenses', data).then((r) => r.data);
  },
  platformDeleteExpense(id: string) {
    return axios.delete(`/platform/expenses/${id}`).then((r) => r.data);
  },
  platformManualPayment(id: string, data: { amount: number; months: number; note?: string }) {
    return axios.post(`/platform/tenants/${id}/manual-payment`, data).then((r) => r.data);
  },
  platformListReferrers() {
    return axios.get('/platform/referrers').then((r) => r.data);
  },
  pointStatus() {
    return axios.get('/point/status').then((r) => r.data);
  },
  pointConnect() {
    return axios.get('/point/connect').then((r) => r.data as { url: string });
  },
  pointDisconnect() {
    return axios.delete('/point/connection');
  },
  pointTerminals() {
    return axios.get('/point/terminals').then((r) => r.data as { id: string; external_pos_id?: string }[]);
  },
  pointRegisterTerminal(terminalId: string) {
    return axios.post('/point/terminal', { terminalId }).then((r) => r.data);
  },
  pointStartCharge(clientSaleId: string, amount: number) {
    return axios.post('/point/charges', { clientSaleId, amount }).then((r) => r.data);
  },
  pointCharge(id: string) {
    return axios.get(`/point/charges/${id}`).then((r) => r.data);
  },
  pointCancelCharge(id: string) {
    return axios.post(`/point/charges/${id}/cancel`).then((r) => r.data);
  },
  uberConnect() {
    return axios.get('/integrations/uber/connect').then((r) => r.data as { url: string });
  },
  uberPending() {
    return axios.get('/integrations/uber/pending').then((r) => r.data as { stores: { storeId: string; name: string; address: string }[] });
  },
  uberActivate(storeId: string) {
    return axios.post('/integrations/uber/activate', { storeId }).then((r) => r.data);
  },
  uberSetAutoPublish(autoPublish: boolean) {
    return axios.put('/integrations/uber/menu/auto', { autoPublish }).then((r) => r.data);
  },
  uberPrep() {
    return axios.get('/integrations/uber/prep').then((r) => r.data as { linked: boolean; prepMinutes: number | null; error?: string });
  },
  uberSetPrep(minutes: number) {
    return axios.put('/integrations/uber/prep', { minutes }).then((r) => r.data);
  },
  uberRemove() {
    return axios.post('/integrations/uber/remove').then((r) => r.data as { url: string });
  },
  uberMenuStatus() {
    return axios.get('/integrations/uber/menu').then((r) => r.data);
  },
  uberPublishMenu(open: string, close: string) {
    return axios.post('/integrations/uber/menu', { open, close }).then((r) => r.data);
  },
  uberMetrics(days = 7) {
    return axios.get('/integrations/uber/metrics', { params: { days } }).then((r) => r.data);
  },
  uberReconcile() {
    return axios.post('/integrations/uber/reconcile').then((r) => r.data);
  },
  platformUber(days = 7) {
    return axios.get('/platform/uber', { params: { days } }).then((r) => r.data);
  },
  uberStoreStatus() {
    return axios.get('/integrations/uber/store').then((r) => r.data);
  },
  uberSetStoreStatus(status: 'ONLINE' | 'PAUSED', minutes?: number) {
    return axios.put('/integrations/uber/store', { status, minutes }).then((r) => r.data);
  },
  uberSetAutoPause(autoPause: boolean) {
    return axios.put('/integrations/uber/autopause', { autoPause }).then((r) => r.data);
  },
  uberStatus() {
    return axios.get('/integrations/uber').then((r) => r.data);
  },
  uberLink(storeId: string) {
    return axios.put('/integrations/uber', { storeId }).then((r) => r.data);
  },
  uberUnlink() {
    return axios.delete('/integrations/uber').then((r) => r.data);
  },
  acceptExternalOrder(orderId: string, prepMinutes?: number) {
    return axios.put(`/orders/${orderId}/external/accept`, { prepMinutes }).then((r) => r.data);
  },
  cancelExternalOrder(orderId: string, code: string, details = '') {
    return axios.put(`/orders/${orderId}/external/cancel`, { code, details }).then((r) => r.data);
  },
  externalDeliveryStatus(orderId: string, status: string) {
    return axios.put(`/orders/${orderId}/external/delivery`, { status }).then((r) => r.data);
  },
  denyExternalOrder(orderId: string, code: string, explanation = '') {
    return axios.put(`/orders/${orderId}/external/deny`, { code, explanation }).then((r) => r.data);
  },
  changePassword(data: { currentPassword: string; newPassword: string }) {
    return axios.put('/usuarios/password', data).then((r) => r.data);
  },
  supportList() {
    return axios.get('/support/tickets').then((r) => r.data);
  },
  supportCreate(data: { subject: string; message: string }) {
    return axios.post('/support/tickets', data).then((r) => r.data);
  },
  supportReply(id: string, message: string) {
    return axios.post(`/support/tickets/${id}/messages`, { message }).then((r) => r.data);
  },
  platformSupport(params: { status?: string; q?: string } = {}) {
    return axios.get('/platform/support', { params }).then((r) => r.data);
  },
  platformTenantTickets(tenantId: string) {
    return axios.get(`/platform/tenants/${tenantId}/tickets`).then((r) => r.data);
  },
  platformCreateTicket(tenantId: string, data: { subject: string; message: string }) {
    return axios.post(`/platform/tenants/${tenantId}/tickets`, data).then((r) => r.data);
  },
  platformGetTicket(id: string) {
    return axios.get(`/platform/tickets/${id}`).then((r) => r.data);
  },
  platformReplyTicket(id: string, message: string) {
    return axios.post(`/platform/tickets/${id}/reply`, { message }).then((r) => r.data);
  },
  platformSetTicketClosed(id: string, closed: boolean) {
    return axios.post(`/platform/tickets/${id}/${closed ? 'close' : 'reopen'}`).then((r) => r.data);
  },
  platformMySeller() {
    return axios.get('/platform/my-seller').then((r) => r.data);
  },
  platformActivateMySeller() {
    return axios.post('/platform/my-seller').then((r) => r.data);
  },
  platformGetReferrer(id: string) {
    return axios.get(`/platform/referrers/${id}`).then((r) => r.data);
  },
  platformCreateReferrer(data: Record<string, unknown>) {
    return axios.post('/platform/referrers', data).then((r) => r.data);
  },
  platformUpdateReferrer(id: string, data: Record<string, unknown>) {
    return axios.patch(`/platform/referrers/${id}`, data).then((r) => r.data);
  },
  platformPayReferrer(id: string, note?: string) {
    return axios.post(`/platform/referrers/${id}/payouts`, { note }).then((r) => r.data);
  },
  platformVoidCommission(id: string, reason?: string) {
    return axios.post(`/platform/commissions/${id}/void`, { reason }).then((r) => r.data);
  },
  platformReferrerUsers(id: string) {
    return axios.get(`/platform/referrers/${id}/users`).then((r) => r.data);
  },
  platformCreateReferrerUser(id: string, data: Record<string, unknown>) {
    return axios.post(`/platform/referrers/${id}/users`, data).then((r) => r.data);
  },
  platformSetReferrerUserActive(id: string, userId: string, active: boolean) {
    return axios.put(`/platform/referrers/${id}/users/${userId}/active`, { active }).then((r) => r.data);
  },
  platformSetTenantReferrer(tenantId: string, code: string | null) {
    return axios.put(`/platform/tenants/${tenantId}/referrer`, { code }).then((r) => r.data);
  },
  checkReferralCode(code: string) {
    return axios.get(`/usuarios/referral/${encodeURIComponent(code)}`).then((r) => r.data);
  },
  partnerHome() {
    return axios.get('/partner/home').then((r) => r.data);
  },
  partnerClients() {
    return axios.get('/partner/clients').then((r) => r.data);
  },
  partnerClient(id: string) {
    return axios.get(`/partner/clients/${id}`).then((r) => r.data);
  },
  partnerAddNote(id: string, text: string) {
    return axios.post(`/partner/clients/${id}/notes`, { text }).then((r) => r.data);
  },
  partnerAssign(id: string, username: string | null) {
    return axios.put(`/partner/clients/${id}/assignee`, { username }).then((r) => r.data);
  },
  partnerCommissions() {
    return axios.get('/partner/commissions').then((r) => r.data);
  },
  partnerTeam() {
    return axios.get('/partner/team').then((r) => r.data);
  },
  partnerCreateMember(data: Record<string, unknown>) {
    return axios.post('/partner/team', data).then((r) => r.data);
  },
  partnerSetMemberActive(id: string, active: boolean) {
    return axios.put(`/partner/team/${id}/${active ? 'reactivate' : 'deactivate'}`).then((r) => r.data);
  },
  partnerChangeRole(id: string, role: string) {
    return axios.put(`/partner/team/${id}/role`, { role }).then((r) => r.data);
  },
  platformListStaff() {
    return axios.get('/platform/staff').then((r) => r.data);
  },
  platformCreateStaff(data: Record<string, unknown>) {
    return axios.post('/platform/staff', data).then((r) => r.data);
  },
  platformDeleteStaff(id: string) {
    return axios.delete(`/platform/staff/${id}`).then((r) => r.data);
  },
};
