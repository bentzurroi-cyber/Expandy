/** Full-screen celebration when a savings goal reaches 100%. */
export async function fireSavingsGoalConfetti(): Promise<void> {
  const { default: confetti } = await import("canvas-confetti");
  const z = 99999;
  const burst = (x: number, y: number) => {
    void confetti({
      particleCount: 100,
      spread: 70,
      origin: { x, y },
      zIndex: z,
      ticks: 200,
    });
  };
  burst(0.25, 0.65);
  burst(0.75, 0.55);
  window.setTimeout(() => {
    void confetti({
      particleCount: 160,
      spread: 100,
      origin: { x: 0.5, y: 0.4 },
      startVelocity: 45,
      zIndex: z,
      ticks: 250,
    });
  }, 180);
}
