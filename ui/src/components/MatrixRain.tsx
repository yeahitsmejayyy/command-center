import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The rain behind the Neo board.
 *
 * Everything here is deliberately outside React. The canvas is painted from a
 * requestAnimationFrame loop that reads and writes only refs, so a frame of
 * rain never triggers a render — which matters because the thing happening on
 * top of it is usually a drag, and dnd-kit re-measures on every render it sees.
 * There is no state in this component except the two preferences that decide
 * whether it should exist at all.
 *
 * It is also the one piece of ambient motion in the product. The design system
 * says "functional motion only, nothing decorative", and this is decorative on
 * purpose, in one opt-in theme, with the motion preference respected.
 *
 * It renders into <body> rather than into the board. The canvas has to paint
 * underneath the column wells, and the wells draw their background without a
 * stacking context of their own — so a canvas nested inside the shell would
 * land on top of them however low its z-index went. As a sibling of the shell
 * it is simply behind it.
 */

/** Half-width katakana, the digits, and a few symbols. */
const GLYPHS = "ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾓﾔﾕﾗﾘﾜ0123456789:.=*+-<>¦";

/** Column width in CSS pixels, which is also the type size. */
const CELL = 16;

/**
 * How often the glyphs step, in milliseconds.
 *
 * The rain reads as falling type, not as animation, so it wants to be slower
 * than the display. Painting ~18 times a second instead of 60 is also most of
 * why this is cheap enough to leave running under a drag.
 */
const STEP_MS = 55;

/**
 * How hard each step dims what is already on the canvas.
 *
 * This is the rain's opacity dial, inverted: a lower number dims more slowly,
 * so trails live longer and more of them are on screen at once. At 0.08 the
 * rain was faint enough to miss; 0.06 reads as present without becoming a
 * background anyone has to look past to read a card.
 */
const FADE = 0.06;

export function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stilled, setStilled] = useState(prefersReducedMotion);

  // A preference the user can flip while the board is open. Nothing else in
  // this component re-renders, so this is the only state here.
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = () => setStilled(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (stilled) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    // Taken once, at mount, and read off the canvas rather than the document:
    // the canvas is a child of <body>, so it inherits whatever theme is in
    // force, and it is the element these values are actually for.
    const styles = getComputedStyle(canvas);
    // --rain-* are declared only inside [data-theme="neo"], which is what makes
    // this safe to read at any moment: if the attribute is not on the document
    // yet, these resolve to nothing and the fallbacks below apply — and the
    // fallbacks are Neo's own greens, because Neo is the only theme that rains.
    //
    // Reading --primary and --ink here instead, as this used to, made the rain
    // whatever colour the board happened to be when the canvas mounted. React
    // runs a child's effect before its parent's, and the attribute is set in
    // App's effect — so on a cold load the document was still the default
    // theme and the rain came out brand orange. Switching in from Cyberpunk
    // made it cyan. The colour was never Neo's except by luck.
    const trail = styles.getPropertyValue("--rain-trail").trim() || "#00FF41";
    const head = styles.getPropertyValue("--rain-head").trim() || "#D6FFD9";
    // A canvas font string is not CSS and will not resolve a custom property,
    // so the stack has to be read out rather than referenced.
    const mono = styles.getPropertyValue("--font-mono").trim() || "monospace";

    /** The y position of each column's leading glyph, in cells. */
    let heads: number[] = [];
    let rows = 0;

    const measure = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // Painting at device resolution and scaling the context keeps the
      // glyphs sharp; without it the rain is visibly soft on a retina screen.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = `${CELL}px ${mono}`;
      context.textBaseline = "top";

      rows = Math.ceil(height / CELL);
      const columns = Math.ceil(width / CELL);
      // Stagger the start so the first screen is already raining rather than
      // every column dropping from the top in unison.
      heads = Array.from({ length: columns }, () => Math.floor(Math.random() * -rows));

      // A fresh buffer is transparent, and the fade below never fully clears,
      // so lay down the background once per resize.
      context.fillStyle = "#000000";
      context.fillRect(0, 0, width, height);
    };

    const step = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      // The trail: each step dims what is already there instead of clearing
      // it, which is what makes the glyphs appear to fall and decay.
      context.fillStyle = `rgba(0, 0, 0, ${FADE})`;
      context.fillRect(0, 0, width, height);

      for (let column = 0; column < heads.length; column += 1) {
        const y = heads[column] ?? 0;
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "0";
        const x = column * CELL;

        if (y >= 0) {
          context.fillStyle = head;
          context.fillText(glyph, x, y * CELL);
          // One glyph back, in the trail colour: the pair is what reads as a
          // bright head pulling a dim tail.
          if (y >= 1) {
            context.fillStyle = trail;
            context.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "0", x, (y - 1) * CELL);
          }
        }

        // Past the bottom, restart somewhere above the top at random, so the
        // columns never resynchronise into stripes.
        heads[column] = y * CELL > height && Math.random() > 0.975 ? Math.floor(Math.random() * -20) : y + 1;
      }
    };

    let frame = 0;
    let last = 0;

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < STEP_MS) return;
      last = now;
      step();
    };

    const start = () => {
      if (frame) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    // A hidden tab throttles rAF but does not reliably stop it, and a board
    // left open in a background tab should cost nothing at all.
    const onVisibility = () => (document.hidden ? stop() : start());

    measure();
    start();
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stilled]);

  if (stilled) return null;

  return createPortal(<canvas ref={canvasRef} className="cc-rain" aria-hidden="true" />, document.body);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
