export class DomFx {
  constructor(private readonly layer: HTMLElement) {}

  hearts(x: number, y: number, count = 5): void {
    for (let index = 0; index < count; index += 1) {
      const heart = document.createElement("span");
      heart.className = "heart-particle";
      heart.textContent = index % 3 === 0 ? "✦" : "♥";
      heart.style.left = `${x + (index - (count - 1) / 2) * 12}px`;
      heart.style.top = `${y}px`;
      heart.style.setProperty("--drift", `${(index - (count - 1) / 2) * 18}px`);
      heart.style.animationDelay = `${index * 35}ms`;
      this.layer.append(heart);
      heart.addEventListener("animationend", () => heart.remove(), { once: true });
    }
  }

  dispose(): void {
    this.layer.replaceChildren();
  }
}
