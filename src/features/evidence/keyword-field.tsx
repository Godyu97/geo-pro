"use client";

export function KeywordField({
  id,
  name,
  defaultValue,
  hintId,
  className,
}: {
  id: string;
  name: string;
  defaultValue: string;
  hintId: string;
  className: string;
}) {
  return (
    <input
      id={id}
      name={name}
      defaultValue={defaultValue}
      maxLength={500}
      autoComplete="off"
      spellCheck={false}
      aria-describedby={hintId}
      className={className}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }}
    />
  );
}
