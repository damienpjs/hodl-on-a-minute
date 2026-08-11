import { Game } from "@/components/game/game";

export default function Home() {
  return (
    // No padding and no max width: the board is the screen, edge to edge. The
    // frame draws its own background, so there is nothing left for the page to
    // put around it.
    <main className="flex flex-1 flex-col">
      <Game />
    </main>
  );
}
