/**
 * The implementation of `asChild` — handing the props a part would carry to the consumer's
 * own element.
 *
 * ## Why it is needed
 *
 * "Unstyled" has two levels. The first is producing no styles, which `className` already
 * solves. The second is **producing no element**: the consumer already has their own
 * `<Button>` (with its own focus ring, its own loading state, its own design tokens), and
 * frond's `NextTrigger` only wants to contribute two things, "pressing it turns the page"
 * and "at the end it is disabled". Without `asChild`, the consumer could only wrap their
 * button inside our `<button>` — and a nested button is invalid HTML that breaks both the
 * keyboard and screen readers.
 *
 * So this takes the same route as Radix: with `asChild` on, no element of our own is
 * rendered and the props are merged into the single child instead.
 *
 * ## Merge rules
 *
 * The child's props beat the part's props, with three exceptions:
 *
 *   - `on*` event handlers both run, **the child first**. The part's side is behaviour
 *     (turning the page) and the child's side is whatever the consumer wants to do (closing
 *     a menu); either order is reasonable, and matching Radix means one fewer difference to
 *     remember.
 *   - `className` is concatenated. Both sides are describing appearance, and overwriting
 *     either loses information.
 *   - `style` is shallow-merged, with the child's keys winning.
 *
 * Both sides receive the ref.
 */

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  version,
  type ReactElement,
  type ReactNode,
} from "react";

type AnyProps = Record<string, unknown>;

/**
 * From React 19 on, `ref` is an ordinary prop and `element.ref` becomes a compatibility
 * getter that logs a warning. 18 is the opposite: `ref` is never in props.
 *
 * Reading both is not an option — touching `element.ref` on 19 logs that warning, and it
 * would appear in the console of every consumer using `asChild`. So the version is checked
 * once here and only the correct side is read.
 */
const RENDERS_REF_AS_PROP = Number.parseInt(version, 10) >= 19;

function childRefOf(element: ReactElement): unknown {
  return RENDERS_REF_AS_PROP
    ? (element.props as AnyProps)["ref"]
    : (element as unknown as AnyProps)["ref"];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assignRef(ref: unknown, node: unknown): void {
  if (typeof ref === "function") {
    // The ref callback's return value is deliberately not returned. React 19 would treat it
    // as a cleanup function while 18 ignores it — do not put something with different
    // semantics on the two sides into a shared path.
    (ref as (value: unknown) => void)(node);
    return;
  }
  if (isPlainObject(ref) && "current" in ref) {
    ref["current"] = node;
  }
}

function composeRefs(...refs: readonly unknown[]): (node: unknown) => void {
  return (node) => {
    for (const ref of refs) assignRef(ref, node);
  };
}

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...slotProps };

  for (const [key, childValue] of Object.entries(childProps)) {
    const slotValue = slotProps[key];

    if (
      /^on[A-Z]/.test(key) &&
      typeof slotValue === "function" &&
      typeof childValue === "function"
    ) {
      merged[key] = (...args: readonly unknown[]) => {
        (childValue as (...a: readonly unknown[]) => void)(...args);
        (slotValue as (...a: readonly unknown[]) => void)(...args);
      };
      continue;
    }

    if (key === "className" && typeof slotValue === "string" && typeof childValue === "string") {
      merged[key] = `${slotValue} ${childValue}`;
      continue;
    }

    if (key === "style" && isPlainObject(slotValue) && isPlainObject(childValue)) {
      merged[key] = { ...slotValue, ...childValue };
      continue;
    }

    merged[key] = childValue;
  }

  return merged;
}

export interface SlotProps {
  readonly children?: ReactNode;
}

export const Slot = forwardRef<unknown, SlotProps & AnyProps>(function Slot(props, forwardedRef) {
  const { children, ...slotProps } = props;

  // `Children.only`'s error message is decent, but it does not say who required exactly one
  // child. Throw our own.
  if (!isValidElement(children)) {
    throw new Error(
      "asChild requires exactly one React element as its child — what it received is not an element. " +
        "The usual causes are a wrapping fragment, or a child that is a run of text.",
    );
  }
  if (Children.count(children) !== 1) {
    throw new Error(`asChild requires exactly one React element as its child; it received ${Children.count(children)}.`);
  }

  const child = children as ReactElement<AnyProps>;

  return cloneElement(child, {
    ...mergeProps(slotProps, child.props),
    ref: composeRefs(forwardedRef, childRefOf(child)),
  } as AnyProps);
});
