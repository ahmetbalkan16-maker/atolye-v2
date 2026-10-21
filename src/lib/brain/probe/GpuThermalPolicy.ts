/** Owner instruction, 2026-10-12: one shared A2000 stop for Brain/STT/production.
 * Pure data only; importing this policy performs no probe or other I/O.
 * Stop at the threshold, before allowing work above it.
 * Owner decision 2026-10-21 ("kart sıcaklık stop olarak 85 dereceye çıkart"): 73 → 85 °C. The card's own limits
 * (nvidia-smi -q): target 88 °C, max operating 95 °C, slowdown 100 °C, shutdown 103 °C.
 */
export const A2000_GPU_HARD_STOP_C = 85;
