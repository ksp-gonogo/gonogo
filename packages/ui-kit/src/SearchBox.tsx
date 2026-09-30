import { type InputHTMLAttributes, useRef } from "react";
import styled from "styled-components";
import { IconButton } from "./Button";
import { Input } from "./Form";
import { CloseIcon } from "./Icons";

/**
 * The props of {@link SearchBox}.
 *
 * @category Form
 */
export interface SearchBoxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "onChange"
  > {
  value: string;
  onChange: (next: string) => void;
  /** The clear control's accessible name. Defaults to "Clear search". */
  clearLabel?: string;
}

/**
 * A search box with the kit's own clear control, shown while there is text to
 * clear. Clearing hands focus back to the field.
 *
 * @category Form
 */
export function SearchBox({
  value,
  onChange,
  clearLabel = "Clear search",
  className,
  ...rest
}: Readonly<SearchBoxProps>) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <SearchBox__Root className={className}>
      <SearchBox__Field
        {...rest}
        ref={field}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value !== "" && (
        <SearchBox__Clear
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            onChange("");
            field.current?.focus();
          }}
        >
          <CloseIcon size="var(--icon-size-control)" />
        </SearchBox__Clear>
      )}
    </SearchBox__Root>
  );
}

const SearchBox__Root = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const SearchBox__Field = styled(Input)`
  && {
    padding-right: var(--inset-field-clearable-end);
  }
`;

const SearchBox__Clear = styled(IconButton)`
  position: absolute;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;
