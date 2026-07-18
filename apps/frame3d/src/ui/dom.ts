export const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element #${id}.`);
  return element as T;
};

export function clear(element: Element): void {
  element.replaceChildren();
}

export function cell(row: HTMLTableRowElement, content?: Node | string): HTMLTableCellElement {
  const value = row.insertCell();
  if (typeof content === 'string') value.textContent = content;
  else if (content) value.append(content);
  return value;
}

export function textInput(value: string, label: string, change: (value: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => change(input.value.trim()));
  return input;
}

export function numberInput(value: number | undefined, label: string, change: (value: number) => void, step = 'any'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  input.value = value === undefined ? '' : String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => change(input.value.trim() === '' ? Number.NaN : Number(input.value)));
  return input;
}

export function checkboxInput(value: boolean, label: string, change: (value: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => change(input.checked));
  return input;
}

export function selectInput(value: string, options: Array<[string, string]>, label: string, change: (value: string) => void): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  options.forEach(([optionValue, optionLabel]) => {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  });
  select.value = value;
  select.addEventListener('change', () => change(select.value));
  return select;
}

export function actionButton(label: string, action: () => void, className = 'table-action'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

export function setMessages(element: HTMLElement, messages: string[], emptyMessage: string): void {
  clear(element);
  if (!messages.length) {
    element.textContent = emptyMessage;
    return;
  }
  const list = document.createElement('ul');
  messages.forEach((message) => {
    const item = document.createElement('li');
    item.textContent = message;
    list.append(item);
  });
  element.append(list);
}
