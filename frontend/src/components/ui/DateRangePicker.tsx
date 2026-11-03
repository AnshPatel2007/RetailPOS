import { createContext, useContext, useEffect, useState } from 'react';
import { Button, Dialog, DialogTrigger, RangeCalendar, RangeCalendarStateContext } from 'react-aria-components';
import { CalendarDate, today } from '@internationalized/date';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { calendarDate, datePresets, inputDate, presetRange } from '@/lib/calendarDates';
import { ControlPopover, useSmallScreen } from './Overlay';
import { CalendarMonthGrid, CalendarNavigation } from './DateControl';

export const ReportCalendarTimezone = createContext<string | undefined>(undefined);
function RangeSelectionObserver({ onChange }: { onChange: (selecting: boolean) => void }) {
  const calendar = useContext(RangeCalendarStateContext);
  const selecting = !!calendar?.anchorDate;
  useEffect(() => { onChange(selecting); }, [selecting, onChange]);
  return null;
}
export interface DateRangeValue { startDate: string; endDate: string }
export interface DateRangePickerProps extends DateRangeValue {
  onChange: (range: DateRangeValue) => void;
  timezone?: string;
  label?: string;
  disabled?: boolean;
  allowOpenRange?: boolean;
  maxDays?: number;
  emptyLabel?: string;
}
function rangeLabel(start: string, end: string) {
  const format = (value: string) => { const date = calendarDate(value); return date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date.toDate('UTC')) : ''; };
  if (start && start === end) return format(start);
  return start || end ? `${format(start) || 'Beginning'} – ${format(end) || 'Present'}` : 'All dates';
}

export function DateRangePicker({ startDate, endDate, onChange, timezone, label = 'Date range', disabled, allowOpenRange = true, maxDays, emptyLabel = 'All dates' }: DateRangePickerProps) {
  const reportTimezone = useContext(ReportCalendarTimezone);
  const assignedTimezone = useCalendarTimezone();
  const zone = timezone || reportTimezone || assignedTimezone || 'UTC';
  const small = useSmallScreen();
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [draft, setDraft] = useState({ startDate, endDate });
  const [focused, setFocused] = useState<CalendarDate>(() => calendarDate(startDate) || today(zone));
  const start = calendarDate(draft.startDate), end = calendarDate(draft.endDate);
  const valid = (!draft.startDate || !!start) && (!draft.endDate || !!end) && (allowOpenRange || (!!start && !!end)) && (!start || !end || (start.compare(end) <= 0 && (!maxDays || end.compare(start) < maxDays)));
  const apply = (range: DateRangeValue) => { onChange(range); setOpen(false); };
  const description = startDate || endDate ? rangeLabel(startDate, endDate) : emptyLabel;
  return <DialogTrigger isOpen={open} onOpenChange={next => { setOpen(next); if (next) { setDraft({ startDate, endDate }); setFocused(calendarDate(startDate) || today(zone)); } }}>
    <Button type="button" isDisabled={disabled} className="date-range-trigger selection-control" aria-label={`${label}: ${description}`}>
      <CalendarDays size={16} aria-hidden="true" /><span>{description}</span><ChevronDown size={16} aria-hidden="true" />
    </Button>
    <ControlPopover className="date-range-popover" placement="bottom start"><Dialog aria-label={label} className="date-range-dialog">
      <div className="date-range-presets" aria-label="Date shortcuts">
        {datePresets.map(([key, title]) => { const range = presetRange(key, zone)!; const tooLong = maxDays && calendarDate(range.endDate)!.compare(calendarDate(range.startDate)!) >= maxDays;
          return <Button type="button" key={key} isDisabled={!!tooLong} className="date-preset" aria-pressed={startDate === range.startDate && endDate === range.endDate} onPress={() => apply(range)}>{title}</Button>; })}
        <span className="date-custom-label">Custom range</span>
      </div>
      <div className="date-range-main">
        <div className="range-fields"><label>From<input aria-label="From date" value={draft.startDate} placeholder="YYYY-MM-DD" onChange={event => { const next = inputDate(event.target.value) ?? event.target.value; setDraft(previous => ({ ...previous, startDate: next })); const date = calendarDate(next); if (date) setFocused(date); }} /></label>
          <label>Through<input aria-label="Through date" value={draft.endDate} placeholder="YYYY-MM-DD" onChange={event => setDraft(previous => ({ ...previous, endDate: inputDate(event.target.value) ?? event.target.value }))} /></label></div>
        <RangeCalendar aria-label="Select date range" value={start && end && start.compare(end) <= 0 ? { start, end } : null} focusedValue={focused} onFocusChange={setFocused}
          visibleDuration={{ months: small ? 1 : 2 }} onChange={range => setDraft({ startDate: range.start.toString(), endDate: range.end.toString() })}>
          <RangeSelectionObserver onChange={setSelecting} />
          <CalendarNavigation focused={focused} onFocusChange={setFocused} />
          <div className="range-calendars"><CalendarMonthGrid caption />{!small && <CalendarMonthGrid offset={1} caption />}</div>
        </RangeCalendar>
        {!valid && <p role="alert" className="field-error">{start && end && start.compare(end) > 0 ? 'End date must be on or after start date.' : maxDays && start && end ? `Choose no more than ${maxDays} days.` : 'Enter a valid date range.'}</p>}
      </div>
      <div className="date-range-footer"><span className="field-description" role="status">{selecting ? 'Choose the end date.' : `Calendar: ${zone}`}</span><Button type="button" className="control-cancel" onPress={() => setOpen(false)}>Cancel</Button><Button type="button" className="control-apply" isDisabled={!valid || selecting} onPress={() => apply(draft)}>Apply</Button></div>
    </Dialog></ControlPopover>
  </DialogTrigger>;
}
