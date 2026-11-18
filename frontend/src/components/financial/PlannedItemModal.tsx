import React, { useEffect, useId, useState } from 'react';
import { today } from '@internationalized/date';
import { Modal } from '@/components/ui/Modal';
import { DialogActions } from '@/components/ui/DialogActions';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Alert } from '@/components/ui/Alert';
import { financialService, apiErrorMessage } from '@/services/api';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';

/** Money the owner expects that no record shows: a loan payment, an owner draw, a tax refund. */
export interface PlannedItem {
  id: string; label: string; direction: 'IN' | 'OUT'; amount: number; repeat: 'ONCE' | 'WEEKLY' | 'MONTHLY';
  date: string | null; weekday: number | null; dayOfMonth: number | null; endsOn: string | null;
}
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const blank = (day: string) => ({ label: '', direction: 'OUT', amount: '', repeat: 'MONTHLY', date: day, weekday: '1', dayOfMonth: '1', endsOn: '' });

export function PlannedItemModal({ isOpen, item, onClose, onSaved }: { isOpen: boolean; item: PlannedItem | null; onClose: () => void; onSaved: () => void }) {
  const timezone = useCalendarTimezone();
  const formId = useId();
  const [form, setForm] = useState(() => blank(today(timezone).toString()));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setForm(item ? { label: item.label, direction: item.direction, amount: item.amount.toFixed(2), repeat: item.repeat, date: item.date ?? today(timezone).toString(),
      weekday: String(item.weekday ?? 1), dayOfMonth: String(item.dayOfMonth ?? 1), endsOn: item.endsOn ?? '' } : blank(today(timezone).toString()));
  }, [isOpen, item, timezone]);
  const change = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(current => ({ ...current, [field]: event.target.value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.label.trim()) { setError('Name the item.'); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(form.amount.trim()) || amount <= 0) { setError('Enter an amount above zero, to the cent.'); return; }
    const data = { label: form.label.trim(), direction: form.direction, amount, repeat: form.repeat,
      date: form.repeat === 'ONCE' ? form.date : null, weekday: form.repeat === 'WEEKLY' ? Number(form.weekday) : null,
      dayOfMonth: form.repeat === 'MONTHLY' ? Number(form.dayOfMonth) : null, endsOn: form.repeat !== 'ONCE' && form.endsOn ? form.endsOn : null };
    setSaving(true); setError('');
    try {
      if (item) await financialService.updateCashPlanItem(item.id, data);
      else await financialService.createCashPlanItem(data);
      onSaved(); onClose();
    } catch (failure) { setError(apiErrorMessage(failure, 'The planned item could not be saved. Try again.')); }
    finally { setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!saving) onClose(); }} title={item ? 'Edit Planned Item' : 'Add Planned Item'} size="sm"
      description="Money you expect that the store's records cannot show, such as a loan payment or an owner draw."
      footer={<DialogActions form={formId} confirmLabel={item ? 'Save Item' : 'Add Item'} loading={saving} onCancel={onClose} />}>
      <form id={formId} onSubmit={save} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Name" value={form.label} onChange={change('label')} maxLength={80} placeholder="Loan payment" autoFocus />
        <Select label="Money" value={form.direction} onChange={change('direction')}>
          <option value="OUT">Goes out</option>
          <option value="IN">Comes in</option>
        </Select>
        <Input label="Amount" type="number" inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={change('amount')} placeholder="0.00" />
        <Select label="When" value={form.repeat} onChange={change('repeat')}>
          <option value="ONCE">Once</option>
          <option value="WEEKLY">Every week</option>
          <option value="MONTHLY">Every month</option>
        </Select>
        {form.repeat === 'ONCE' && <Input label="Day" type="date" value={form.date} onChange={change('date')} />}
        {form.repeat === 'WEEKLY' && <Select label="Weekday" value={form.weekday} onChange={change('weekday')}>
          {WEEKDAYS.map((name, index) => <option key={name} value={String(index)}>{name}</option>)}
        </Select>}
        {form.repeat === 'MONTHLY' && <Select label="Day of the month" value={form.dayOfMonth} onChange={change('dayOfMonth')}
          description="A day a month does not have counts as that month's last day.">
          {Array.from({ length: 31 }, (_, index) => <option key={index} value={String(index + 1)}>{index + 1}</option>)}
        </Select>}
        {form.repeat !== 'ONCE' && <Input label="Last day (optional)" type="date" value={form.endsOn} onChange={change('endsOn')} />}
      </form>
    </Modal>
  );
}
