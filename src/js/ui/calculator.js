// Modal de calculadora integrada aos campos numéricos do Ledgerly Pro.

// =========================================================================
// 6. CALCULADORA INTEGRADA (MODAL COM SALVAR E CANCELAR)
// =========================================================================
function openCalculator(targetInputId, labelText) {
  currentCalcTargetId = targetInputId;
  document.getElementById('calcTargetLabel').textContent = labelText || 'Calculadora';

  const targetEl = document.getElementById(targetInputId);
  const initialVal = targetEl && targetEl.value ? String(targetEl.value).trim() : '';
  currentCalcExpression = initialVal && initialVal !== '0' ? initialVal : '';

  updateCalculatorDisplay();
  document.getElementById('calculatorModal').classList.remove('hidden');
  lucide.createIcons();
}

function closeCalculator() {
  document.getElementById('calculatorModal').classList.add('hidden');
  currentCalcTargetId = null;
  currentCalcExpression = '';
}

function calcInput(token) {
  if (token === 'C') {
    currentCalcExpression = '';
  } else if (token === 'BACK') {
    currentCalcExpression = currentCalcExpression.slice(0, -1);
  } else {
    currentCalcExpression += token;
  }
  updateCalculatorDisplay();
}

function evaluateSafeMathExpression(expr) {
  if (!expr) return 0;
  const sanitized = expr.replace(/,/g, '.').replace(/[^0-9+\-*/().]/g, '');
  if (!sanitized) return 0;
  try {
    const result = Function(`"use strict"; return (${sanitized})`)();
    return typeof result === 'number' && isFinite(result) ? Number(result.toFixed(4)) : 0;
  } catch (_) {
    return null;
  }
}

function calcEvaluate() {
  const val = evaluateSafeMathExpression(currentCalcExpression);
  if (val !== null) {
    currentCalcExpression = String(val);
    updateCalculatorDisplay();
  }
}

function updateCalculatorDisplay() {
  const exprEl = document.getElementById('calcExpressionDisplay');
  const resEl = document.getElementById('calcResultDisplay');

  exprEl.textContent = currentCalcExpression || '0';
  const evaluated = evaluateSafeMathExpression(currentCalcExpression);
  if (evaluated !== null) {
    resEl.textContent = evaluated.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  }
}

function applyCalculatorValue() {
  if (!currentCalcTargetId) {
    closeCalculator();
    return;
  }
  const finalVal = evaluateSafeMathExpression(currentCalcExpression);
  if (finalVal === null) {
    showToast('Expressão matemática inválida.', 'error');
    return;
  }

  const targetEl = document.getElementById(currentCalcTargetId);
  if (targetEl) {
    targetEl.value = finalVal;
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
    targetEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeCalculator();
  showToast('Valor calculado aplicado ao campo!', 'success');
}

// Ponte de compatibilidade: mantém os nomes públicos acessíveis ao HTML e aos demais módulos.
Object.defineProperty(globalThis, "openCalculator", { configurable: true, enumerable: true, get: () => openCalculator, set: value => { openCalculator = value; } });
Object.defineProperty(globalThis, "closeCalculator", { configurable: true, enumerable: true, get: () => closeCalculator, set: value => { closeCalculator = value; } });
Object.defineProperty(globalThis, "calcInput", { configurable: true, enumerable: true, get: () => calcInput, set: value => { calcInput = value; } });
Object.defineProperty(globalThis, "evaluateSafeMathExpression", { configurable: true, enumerable: true, get: () => evaluateSafeMathExpression, set: value => { evaluateSafeMathExpression = value; } });
Object.defineProperty(globalThis, "calcEvaluate", { configurable: true, enumerable: true, get: () => calcEvaluate, set: value => { calcEvaluate = value; } });
Object.defineProperty(globalThis, "updateCalculatorDisplay", { configurable: true, enumerable: true, get: () => updateCalculatorDisplay, set: value => { updateCalculatorDisplay = value; } });
Object.defineProperty(globalThis, "applyCalculatorValue", { configurable: true, enumerable: true, get: () => applyCalculatorValue, set: value => { applyCalculatorValue = value; } });
