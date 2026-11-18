export type CalcOperator = '+' | '-' | '*' | '/';

export interface CalcState {
  display: string;
  accumulator: number | null;
  pendingOp: CalcOperator | null;
  waitingForOperand: boolean;
  expression: string;
  error: boolean;
}

export const INITIAL_CALC_STATE: CalcState = {
  display: '0',
  accumulator: null,
  pendingOp: null,
  waitingForOperand: false,
  expression: '',
  error: false,
};

function formatCalcNumber(num: number): string {
  if (!Number.isFinite(num)) return 'Error';
  const rounded = Math.abs(num) < 1e-12 ? 0 : Number(num.toPrecision(12));
  const str = String(rounded);
  return str.length > 14 ? rounded.toExponential(7) : str;
}

function applyBinaryOp(left: number, right: number, op: CalcOperator): number | null {
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      if (right === 0) return null;
      return left / right;
  }
}

export function calcClear(): CalcState {
  return { ...INITIAL_CALC_STATE };
}

export function calcClearEntry(state: CalcState): CalcState {
  if (state.error) return calcClear();
  return {
    ...state,
    display: '0',
    waitingForOperand: false,
  };
}

export function calcBackspace(state: CalcState): CalcState {
  if (state.error) return calcClear();
  if (state.waitingForOperand) return state;
  if (state.display.length <= 1 || (state.display.length === 2 && state.display.startsWith('-'))) {
    return { ...state, display: '0' };
  }
  return { ...state, display: state.display.slice(0, -1) };
}

export function calcInputDigit(state: CalcState, digit: string): CalcState {
  if (!/^[0-9]$/.test(digit)) return state;
  if (state.error) {
    return { ...INITIAL_CALC_STATE, display: digit };
  }
  if (state.waitingForOperand) {
    return {
      ...state,
      display: digit,
      waitingForOperand: false,
    };
  }
  if (state.display === '0') {
    return { ...state, display: digit };
  }
  if (state.display.replace(/[^0-9]/g, '').length >= 12) return state;
  return { ...state, display: state.display + digit };
}

export function calcInputDecimal(state: CalcState): CalcState {
  if (state.error) {
    return { ...INITIAL_CALC_STATE, display: '0.' };
  }
  if (state.waitingForOperand) {
    return {
      ...state,
      display: '0.',
      waitingForOperand: false,
    };
  }
  if (state.display.includes('.')) return state;
  return { ...state, display: state.display + '.' };
}

export function calcInputOperator(state: CalcState, nextOp: CalcOperator): CalcState {
  if (state.error) return calcClear();
  const inputValue = Number(state.display);
  if (!Number.isFinite(inputValue)) {
    return { ...INITIAL_CALC_STATE, display: 'Error', error: true };
  }

  if (state.accumulator === null) {
    return {
      ...state,
      accumulator: inputValue,
      pendingOp: nextOp,
      waitingForOperand: true,
      expression: `${formatCalcNumber(inputValue)} ${nextOp}`,
    };
  }

  if (state.waitingForOperand && state.pendingOp) {
    return {
      ...state,
      pendingOp: nextOp,
      expression: `${formatCalcNumber(state.accumulator)} ${nextOp}`,
    };
  }

  const result = state.pendingOp ? applyBinaryOp(state.accumulator, inputValue, state.pendingOp) : inputValue;
  if (result === null || !Number.isFinite(result)) {
    return {
      display: 'Error',
      accumulator: null,
      pendingOp: null,
      waitingForOperand: true,
      expression: 'Cannot divide by zero',
      error: true,
    };
  }

  const formatted = formatCalcNumber(result);
  return {
    display: formatted,
    accumulator: result,
    pendingOp: nextOp,
    waitingForOperand: true,
    expression: `${formatted} ${nextOp}`,
    error: false,
  };
}

export function calcEquals(state: CalcState): CalcState {
  if (state.error) return state;
  if (state.accumulator === null || state.pendingOp === null) return state;

  const right = Number(state.display);
  const result = applyBinaryOp(state.accumulator, right, state.pendingOp);
  if (result === null || !Number.isFinite(result)) {
    return {
      display: 'Error',
      accumulator: null,
      pendingOp: null,
      waitingForOperand: true,
      expression: 'Cannot divide by zero',
      error: true,
    };
  }

  const formatted = formatCalcNumber(result);
  return {
    display: formatted,
    accumulator: null,
    pendingOp: null,
    waitingForOperand: true,
    expression: `${formatCalcNumber(state.accumulator)} ${state.pendingOp} ${formatCalcNumber(right)} =`,
    error: false,
  };
}

export function calcUnaryOp(
  state: CalcState,
  op: 'sqrt' | 'sq' | 'inv' | 'negate' | 'pct'
): CalcState {
  if (state.error) return calcClear();
  const val = Number(state.display);
  if (!Number.isFinite(val)) {
    return { ...INITIAL_CALC_STATE, display: 'Error', error: true };
  }

  if (op === 'negate') {
    const next = val === 0 ? 0 : -val;
    return { ...state, display: formatCalcNumber(next) };
  }

  if (op === 'pct') {
    const next =
      state.accumulator !== null && state.pendingOp
        ? (state.accumulator * val) / 100
        : val / 100;
    return { ...state, display: formatCalcNumber(next), waitingForOperand: false };
  }

  if (op === 'sqrt') {
    if (val < 0) {
      return {
        display: 'Error',
        accumulator: null,
        pendingOp: null,
        waitingForOperand: true,
        expression: 'Invalid input for √',
        error: true,
      };
    }
    return {
      ...state,
      display: formatCalcNumber(Math.sqrt(val)),
      waitingForOperand: true,
    };
  }

  if (op === 'sq') {
    return {
      ...state,
      display: formatCalcNumber(val * val),
      waitingForOperand: true,
    };
  }

  if (val === 0) {
    return {
      display: 'Error',
      accumulator: null,
      pendingOp: null,
      waitingForOperand: true,
      expression: 'Cannot divide by zero',
      error: true,
    };
  }

  return {
    ...state,
    display: formatCalcNumber(1 / val),
    waitingForOperand: true,
  };
}
