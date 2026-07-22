#!/usr/bin/env bash
set -euo pipefail

VLLM_ENV_DIR="${VLLM_ENV_DIR:-${HOME}/venvs/vllm}"

if [[ ! -f "${VLLM_ENV_DIR}/bin/activate" ]]; then
  echo "vLLM environment not found at ${VLLM_ENV_DIR}." >&2
  echo "Set VLLM_ENV_DIR to the directory containing bin/activate." >&2
  exit 1
fi

# Activation is required because FlashInfer invokes Ninja by executable name.
source "${VLLM_ENV_DIR}/bin/activate"

if ! command -v ninja >/dev/null 2>&1; then
  echo "Ninja is missing from the vLLM environment." >&2
  echo "Install it with: uv pip install --python ${VLLM_ENV_DIR}/bin/python ninja" >&2
  exit 1
fi

exec vllm serve RedHatAI/Qwen3.5-9B-quantized.w4a16 \
  --port 8000 \
  --tensor-parallel-size 1 \
  --max-model-len 8192 \
  --max-num-seqs 1 \
  --gpu-memory-utilization 0.90 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder
