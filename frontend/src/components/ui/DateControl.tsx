import React, { forwardRef, useContext, useEffect, useId, useRef, useState } from 'react';
import { Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, CalendarStateContext, RangeCalendarStateContext, Dialog, DialogTrigger, Heading, Radio, RadioGroup } from 'react-aria-components';
import { CalendarDate, today } from '@internationalized/date';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDate, inputDate, monthLabel } from '@/lib/calendarDates';
import { cn } from '@/lib/utils';
import { ControlPopover } from './Overlay';
import { Select } from './Select';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';

export const monthNames = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, index, 1))));

export function CalendarNavigation({ focused, onFocusChange }: { focused: CalendarDate; onFocusChange: (date: CalendarDate) => void }) {
  return <div className="calendar-navigation">
    <Button type="button" slot="previous" className="calendar-arrow" aria-label="Previous month"><ChevronLeft size={16} /></Button>
    <Heading className="sr-only" />
    <Select aria-label="Calendar month" searchable={false} value={focused.month} onChange={event => onFocusChange(focused.set({ month: Number(event.target.value) }))}>
      {monthNames.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
    </Select>
    <input type="number" aria-label="Calendar year" className="calendar-year" min={1} max={9999} value={focused.year}
      onChange={event => { const year = Number(event.target.value); if (year >= 1 && year <= 9999) onFocusChange(focused.set({ year })); }} />
    <Button type="button" slot="next" className="calendar-arrow" aria-label="Next month"><ChevronRight size={16} /></Button>
  </div>;
}
export function CalendarMonthGrid({ offset = 0, caption = false }: { offset?: number; caption?: boolean }) {
  const calendar = useContext(CalendarStateContext);
  const range = useContext(RangeCalendarStateContext);
  const visibleMonth = (calendar || range)?.visibleRange.start.add({ months: offset }).toString().slice(0, 7);
  return <CalendarGrid offset={{ months: offset }} className="calendar-grid">
    <caption hidden={!caption} className="calendar-month-label">{visibleMonth ? monthLabel(visibleMonth) : ''}</caption>
    <CalendarGridHeader>{day => <CalendarHeaderCell className="calendar-weekday">{day}</CalendarHeaderCell>}</CalendarGridHeader>
    <CalendarGridBody>{date => <CalendarCell date={date} className="calendar-day" />}</CalendarGridBody>
  </CalendarGrid>;
}

interface DateControlProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; description?: string; error?: string }
export const DateControl = forwardRef<HTMLInputElement, DateControlProps>(function DateControl({ label, description, error, value, defaultValue, onChange, onBlur, type = 'date', id, className, min, max, disabled, readOnly, required, ...props }, forwardedRef) {
  const generated = useId();
  const inputId = id || generated;
  const field = useRef<HTMLInputElement | null>(null);
  const isMonth = type === 'month';
  const isTime = type === 'datetime-local';
  const [internal, setInternal] = useState(String(defaultValue ?? ''));
  const current = String(value ?? internal);
  const storeTimezone = useCalendarTimezone();
  const display = (next: string) => isMonth && /^\d{4}-\d{2}$/.test(next) ? monthLabel(next) : next.replace('T', ' ');
  const [raw, setRaw] = useState(display(current));
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState('');
  const [focused, setFocused] = useState(() => calendarDate((isMonth ? current + '-01' : current.slice(0, 10))) || today(isTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : storeTimezone || 'UTC'));
  const [time, setTime] = useState(current.slice(11, 16) || '12:00');
  const [externalLabel, setExternalLabel] = useState('');
  useEffect(() => { setRaw(display(current)); setInvalid(''); field.current?.setCustomValidity(''); }, [current, isMonth]);
  useEffect(() => {
    const wrapper = field.current?.closest('[data-date-field]');
    const preceding = wrapper?.previousElementSibling;
    const parentLabel = wrapper?.closest('label');
    const clone = (parentLabel || (preceding?.tagName === 'LABEL' ? preceding : null))?.cloneNode(true) as HTMLElement | undefined;
    clone?.querySelectorAll('[data-date-field]').forEach(element => element.remove());
    setExternalLabel(clone?.textContent?.trim().replace(/\s*\*$/, '') || '');
  }, []);
  const name = props['aria-label'] || label || externalLabel || props.placeholder || (isMonth ? 'Month' : isTime ? 'Date and time' : 'Date');
  const emit = (next: string) => {
    if (value === undefined) setInternal(next);
    setRaw(display(next)); setInvalid(''); field.current?.setCustomValidity('');
    const target = field.current;
    if (target) {
      target.value = next;
      onChange?.({ target, currentTarget: target, type: 'change' } as React.ChangeEvent<HTMLInputElement>);
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  const validate = (text: string) => {
    if (!text) return '';
    if (isMonth) return /^\d{4}-\d{2}$/.test(text) && calendarDate(text + '-01') ? text : null;
    if (isTime) {
      const normalized = text.replace(' ', 'T');
      return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(normalized) && calendarDate(normalized.slice(0, 10)) ? normalized : null;
    }
    return inputDate(text);
  };
  const withinBounds = (next: string) => !next || ((!min || next >= String(min)) && (!max || next <= String(max)));
  const chooseDay = (date: CalendarDate) => {
    if (isTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
    const next = date.toString() + (isTime ? 'T' + time : '');
    if (withinBounds(next)) { emit(next); setOpen(false); }
  };
  return <div data-date-field className={cn('date-field min-w-0 w-full', className)}>
    {label && <label htmlFor={inputId} className="field-label">{label}</label>}
    <DialogTrigger isOpen={open} onOpenChange={next => {
      setOpen(next);
      if (next) { setFocused(calendarDate(isMonth ? current + '-01' : current.slice(0, 10)) || today(isTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : storeTimezone)); setTime(current.slice(11, 16) || '12:00'); }
    }}>
      <div className="date-control" data-invalid={!!(error || invalid) || undefined}>
        <input {...props} id={inputId} ref={element => { field.current = element; if (typeof forwardedRef === 'function') forwardedRef(element); else if (forwardedRef) forwardedRef.current = element; }}
          type="text" value={raw} disabled={disabled} readOnly={readOnly} required={required} aria-label={name}
          aria-invalid={!!(error || invalid) || undefined} aria-describedby={[props['aria-describedby'], description ? inputId + '-description' : '', error || invalid ? inputId + '-error' : ''].filter(Boolean).join(' ') || undefined}
          placeholder={props.placeholder || (isMonth ? 'YYYY-MM' : isTime ? 'YYYY-MM-DD HH:mm' : 'MM/DD/YYYY')}
          className="date-text" onChange={event => {
            const nextRaw = event.target.value; setRaw(nextRaw);
            const next = validate(nextRaw);
            if (next !== null && withinBounds(next)) emit(next);
            else { field.current?.setCustomValidity('Enter a valid ' + (isMonth ? 'month' : 'date') + ' within the allowed range.'); }
          }} onBlur={event => {
            if (raw !== display(current) && (validate(raw) === null || !withinBounds(validate(raw) || ''))) setInvalid('Enter a valid ' + (isMonth ? 'month (YYYY-MM).' : isTime ? 'date and time (YYYY-MM-DD HH:mm).' : 'date (MM/DD/YYYY).'));
            onBlur?.(event);
          }} />
        <Button type="button" className="date-trigger" isDisabled={disabled || readOnly} aria-label={'Choose ' + name.toLowerCase()}><CalendarDays size={16} aria-hidden="true" /></Button>
      </div>
      <ControlPopover className="calendar-popover"><Dialog aria-label={'Choose ' + name.toLowerCase()} className="calendar-dialog">
        {isMonth ? <>
          <div className="calendar-navigation"><Button type="button" className="calendar-arrow" aria-label="Previous year" isDisabled={focused.year <= 1} onPress={() => setFocused(focused.subtract({ years: 1 }))}><ChevronLeft size={16} /></Button>
            <label className="calendar-year-label">Year<input aria-label="Year" className="calendar-year" type="number" min={1} max={9999} value={focused.year} onChange={event => { const year = Number(event.target.value); if (year >= 1 && year <= 9999) setFocused(focused.set({ year })); }} /></label>
            <Button type="button" className="calendar-arrow" aria-label="Next year" isDisabled={focused.year >= 9999} onPress={() => setFocused(focused.add({ years: 1 }))}><ChevronRight size={16} /></Button></div>
          <RadioGroup aria-label="Month" value={current} onChange={next => { emit(next); setOpen(false); }} className="month-grid">
            {monthNames.map((month, index) => { const key = `${String(focused.year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`; return <Radio key={key} value={key} isDisabled={!withinBounds(key)} className="month-choice">{month}</Radio>; })}
          </RadioGroup>
        </> : <>
          <Calendar aria-label="Calendar" value={calendarDate(current.slice(0, 10))} focusedValue={focused} onFocusChange={setFocused} onChange={chooseDay}
            minValue={calendarDate(String(min || '').slice(0, 10)) || undefined} maxValue={calendarDate(String(max || '').slice(0, 10)) || undefined}>
            <CalendarNavigation focused={focused} onFocusChange={setFocused} /><CalendarMonthGrid />
          </Calendar>
          {isTime && <label className="calendar-time">Time (this device)<input aria-label="Time (this device)" type="text" inputMode="numeric" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" value={time} onChange={event => setTime(event.target.value)} /><Button type="button" isDisabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)} onPress={() => chooseDay(focused)}>Apply</Button></label>}
        </>}
        {!required && <div className="calendar-footer"><Button type="button" onPress={() => { emit(''); setOpen(false); }}>Clear</Button></div>}
      </Dialog></ControlPopover>
    </DialogTrigger>
    {description && <p id={inputId + '-description'} className="field-description">{description}</p>}
    {(error || invalid) && <p id={inputId + '-error'} role="alert" className="field-error">{error || invalid}</p>}
  </div>;
});
