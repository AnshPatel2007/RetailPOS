import React, { Children, forwardRef, isValidElement, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, ComboBox, Input, Label, ListBox, ListBoxItem, Select as AriaSelect, SelectValue } from 'react-aria-components';
import { Check, ChevronDown } from 'lucide-react';
import { ControlPopover } from './Overlay';
import { cn } from '@/lib/utils';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'> {
  label?: string;
  description?: string;
  error?: string;
  searchable?: boolean;
  placeholder?: string;
  readOnly?: boolean;
}
interface Choice { id: string; label: string; disabled: boolean }
const textOf = (node: React.ReactNode): string => Children.toArray(node).map(child => isValidElement<{ children?: React.ReactNode }>(child) ? textOf(child.props.children) : String(child)).join('');
function choicesFrom(children: React.ReactNode): Choice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === 'option') return [{ id: String(child.props.value ?? textOf(child.props.children)), label: textOf(child.props.children), disabled: !!child.props.disabled }];
    return choicesFrom(child.props.children);
  });
}

/** Native-value compatibility keeps existing forms, permissions and API payloads intact. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ children, value, defaultValue, onChange, onBlur, name, id, label, description, error, searchable, placeholder, disabled, required, readOnly, className, ...props }, ref) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const root = useRef<HTMLDivElement>(null);
  const options = useMemo(() => choicesFrom(children), [children]);
  const [internal, setInternal] = useState(String(defaultValue ?? options[0]?.id ?? ''));
  const selected = String(value ?? internal);
  const [externalLabel, setExternalLabel] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [validationError, setValidationError] = useState('');
  const retainedLabel = useRef({ id: selected, label: '' });
  const search = searchable ?? options.length > 8;
  const availableLabel = options.find(option => option.id === selected)?.label;
  if (availableLabel !== undefined) retainedLabel.current = { id: selected, label: availableLabel };
  const chosenLabel = availableLabel ?? (retainedLabel.current.id === selected ? retainedLabel.current.label : '');
  useLayoutEffect(() => {
    const element = root.current;
    const associated = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`) : null;
    const wrapper = element?.closest('label') || (element?.previousElementSibling?.tagName === 'LABEL' ? element.previousElementSibling : null);
    const clone = (associated || wrapper)?.cloneNode(true) as HTMLElement | undefined;
    clone?.querySelectorAll('[data-select-field]').forEach(field => field.remove());
    setExternalLabel(clone?.textContent?.trim().replace(/\s*\*$/, '') || '');
    const native = element?.querySelector('select') || null;
    if (typeof ref === 'function') ref(native); else if (ref) ref.current = native;
  }, [id, ref, search]);
  const accessibleName = props['aria-label'] || label || externalLabel || name || placeholder || 'Select option';
  const change = (key: React.Key | null) => {
    if (key == null || readOnly || disabled) return;
    const next = String(key);
    setInternal(next); setQuery(null); setValidationError('');
    const native = root.current?.querySelector('select');
    if (native) native.value = next;
    const target = native || { value: next, name: name || '' };
    onChange?.({ target, currentTarget: target, type: 'change' } as React.ChangeEvent<HTMLSelectElement>);
    // Scoped refresh also observes custom selections made in an editable form.
    root.current?.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const shared = { name: search ? undefined : name, autoFocus: props.autoFocus, form: props.form, isDisabled: disabled || readOnly, isRequired: required, 'aria-label': accessibleName,
    'aria-describedby': [props['aria-describedby'], description ? fieldId + '-description' : '', error || validationError ? fieldId + '-error' : ''].filter(Boolean).join(' ') || undefined,
    isInvalid: !!(error || validationError) || props['aria-invalid'] === true, selectedKey: selected || null, onSelectionChange: change,
    disabledKeys: options.filter(option => option.disabled).map(option => option.id),
    isOpen: open, onOpenChange: (next: boolean, trigger?: string) => { setOpen(next); if (!next || trigger !== 'input') setQuery(null); },
    onBlur: () => onBlur?.({ target: { name, value: selected }, type: 'blur' } as React.FocusEvent<HTMLSelectElement>) };
  const list = (rows: Choice[]) => <ControlPopover className="select-popover"><ListBox items={rows} className="control-list" renderEmptyState={() => <div className="control-empty">No matches found</div>}>
    {item => <ListBoxItem id={item.id} textValue={item.label} className="control-option"><span>{item.label}</span><Check aria-hidden="true" className="selection-check" /></ListBoxItem>}
  </ListBox></ControlPopover>;
  return <div ref={root} data-select-field data-select-label={accessibleName} data-value={selected} className="select-field min-w-0" title={props.title}
    onKeyDown={event => props.onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLSelectElement>)}
    onFocus={event => props.onFocus?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}>
    {search && <select hidden aria-hidden="true" tabIndex={-1} name={name} form={props.form} value={selected} disabled={disabled || readOnly} required={required}
      onChange={event => change(event.target.value)} onInvalid={event => { event.preventDefault(); setValidationError('Choose ' + accessibleName.toLowerCase() + '.'); root.current?.querySelector('input')?.focus(); }}>{children}</select>}
    {search ? <ComboBox {...shared} allowsCustomValue={false} menuTrigger="input" inputValue={query ?? (selected ? chosenLabel : '')} onInputChange={setQuery} items={options}>
      {label && <Label className="field-label">{label}</Label>}
      <div className={cn('selection-control', className)}>
        <Input id={fieldId} className="selection-input" placeholder={placeholder || (!selected && chosenLabel) || 'Search or select…'} />
        <Button type="button" className="selection-toggle" aria-label={'Show ' + accessibleName.toLowerCase()}><ChevronDown aria-hidden="true" size={16} /></Button>
      </div>
      {list(options.filter(option => query == null || option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())))}
    </ComboBox> : <AriaSelect {...shared}>
      {label && <Label className="field-label">{label}</Label>}
      <Button id={fieldId} type="button" aria-label={accessibleName} className={cn('selection-control', className)}><SelectValue className="min-w-0 flex-1 truncate">{chosenLabel || placeholder || 'Select…'}</SelectValue><ChevronDown aria-hidden="true" size={16} /></Button>
      {list(options)}
    </AriaSelect>}
    {description && <p id={fieldId + '-description'} className="field-description">{description}</p>}
    {(error || validationError) && <p id={fieldId + '-error'} role="alert" className="field-error">{error || validationError}</p>}
  </div>;
});
