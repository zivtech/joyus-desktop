import { JSDOM } from "jsdom";
import { createElement, type ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, type MemoryRouterProps } from "react-router-dom";

export interface PageHarness {
  dom: JSDOM;
  container: HTMLElement;
  root: Root | undefined;
}

interface ReactInputProps {
  onChange?: (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void;
}

interface ReactSelectProps {
  onChange?: (event: { target: HTMLSelectElement; currentTarget: HTMLSelectElement }) => void;
}

interface ReactButtonProps {
  onClick?: () => void;
}

export function setupDom(): PageHarness {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  Object.assign(globalThis, {
    Event: dom.window.Event,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    InputEvent: dom.window.InputEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
  const container = dom.window.document.getElementById("root");
  if (container === null) {
    throw new Error("Root container not found");
  }
  return { dom, container, root: undefined };
}

export async function teardownDom(harness: PageHarness): Promise<void> {
  if (harness.root !== undefined) {
    act(() => {
      harness.root?.unmount();
    });
    harness.root = undefined;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  harness.dom.window.close();
}

export function mount(
  harness: PageHarness,
  element: ReactElement,
  routerProps: MemoryRouterProps = {},
): void {
  act(() => {
    harness.root = createRoot(harness.container);
    harness.root.render(createElement(MemoryRouter, routerProps, element));
  });
}

export async function waitFor(predicate: () => boolean, attempts = 80): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error("Timed out waiting for condition");
}

export function findButton(harness: PageHarness, label: string, index = 0): HTMLButtonElement {
  const matches = Array.from(harness.container.querySelectorAll("button"))
    .filter((button) => button.textContent === label);
  const target = matches[index];
  if (!(target instanceof harness.dom.window.HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return target;
}

export function findButtonContaining(harness: PageHarness, text: string, index = 0): HTMLButtonElement {
  const matches = Array.from(harness.container.querySelectorAll("button"))
    .filter((button) => button.textContent?.includes(text) === true);
  const target = matches[index];
  if (!(target instanceof harness.dom.window.HTMLButtonElement)) {
    throw new Error(`Button not found containing: ${text}`);
  }
  return target;
}

export function getReactButtonProps(button: HTMLButtonElement): ReactButtonProps | undefined {
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  if (propsKey === undefined) return undefined;
  return (button as unknown as Record<string, unknown>)[propsKey] as ReactButtonProps;
}

export async function clickButton(harness: PageHarness, label: string, index = 0): Promise<void> {
  const target = findButton(harness, label, index);
  await act(async () => {
    target.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function clickButtonContaining(harness: PageHarness, text: string, index = 0): Promise<void> {
  const target = findButtonContaining(harness, text, index);
  await act(async () => {
    target.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getReactInputProps(input: HTMLInputElement): ReactInputProps | undefined {
  const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
  if (propsKey === undefined) return undefined;
  return (input as unknown as Record<string, unknown>)[propsKey] as ReactInputProps;
}

function getReactSelectProps(select: HTMLSelectElement): ReactSelectProps | undefined {
  const propsKey = Object.keys(select).find((key) => key.startsWith("__reactProps$"));
  if (propsKey === undefined) return undefined;
  return (select as unknown as Record<string, unknown>)[propsKey] as ReactSelectProps;
}

export async function changeInput(harness: PageHarness, input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(harness.dom.window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    getReactInputProps(input)?.onChange?.({ target: input, currentTarget: input });
    input.dispatchEvent(new harness.dom.window.InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText",
    }));
    input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function changeSelect(harness: PageHarness, select: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(harness.dom.window.HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(select, value);
    getReactSelectProps(select)?.onChange?.({ target: select, currentTarget: select });
    select.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
