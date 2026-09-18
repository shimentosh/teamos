import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";

export type PickerOption = {
  value: string;
  label: string;
  /** Muted text on the right, e.g. "GMT+6" or "৳". */
  hint?: string;
};

/**
 * A searchable single choice from a fixed list: type to filter, pick with the
 * mouse or keyboard. For long lists like currencies and timezones.
 */
export function OptionPicker({
  id,
  options,
  value,
  onChange,
  placeholder,
  emptyText,
  disabled,
}: {
  id?: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText: string;
  disabled?: boolean;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Combobox
      items={options}
      value={selected}
      disabled={disabled}
      itemToStringLabel={(option: PickerOption) => option.label}
      itemToStringValue={(option: PickerOption) => option.value}
      isItemEqualToValue={(a: PickerOption, b: PickerOption) =>
        a.value === b.value
      }
      onValueChange={(option: PickerOption | null) => {
        if (option) onChange(option.value);
      }}
    >
      <ComboboxInput id={id} placeholder={placeholder} className="w-full" />
      <ComboboxPopup>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(option: PickerOption) => (
            <ComboboxItem key={option.value} value={option}>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.hint && (
                <span className="ms-3 shrink-0 text-muted-foreground text-xs">
                  {option.hint}
                </span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
