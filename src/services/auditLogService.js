import { apiState } from './api'

const KEY = 'admin.auditLog'
const readAuditLog = async () => (await apiState.get(KEY)) ?? []

export const auditLogService = {
  async add(entry) {
    if (!entry?.action || !entry?.actor || !entry?.targetId || !entry?.note?.trim()) throw new Error('Audit entries require an action, actor, target, and note.')
    const record = {
      id: `AUD-${crypto.randomUUID()}`, action: entry.action, actor: entry.actor,
      targetId: String(entry.targetId), note: entry.note.trim(), details: entry.details ?? {},
      createdAt: new Date().toISOString(),
    }
    await apiState.put(KEY, [record, ...(await readAuditLog())])
    return record
  },
  async list(filters = {}) {
    return (await readAuditLog()).filter((entry) =>
      (!filters.action || entry.action === filters.action) &&
      (!filters.actor || entry.actor === filters.actor) &&
      (!filters.targetId || entry.targetId === String(filters.targetId)),
    )
  },
}
