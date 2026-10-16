import { PALETTE } from "../palette";

interface Props {
  selected: number;
  onSelect: (index: number) => void;
}

/**
 * Una sola fila con scroll horizontal.
 *
 * La versión anterior metía los 16 colores en una rejilla de una fila, lo que
 * en una pantalla de 390px daba swatches de ~20px: por debajo del mínimo de
 * 24px que pide WCAG para objetivos táctiles en web. Y en dos filas de 44px se
 * comían 95px de alto a costa del lienzo.
 *
 * Con scroll horizontal se consiguen las dos cosas: 44px de objetivo táctil
 * (lo cómodo para un dedo) y una sola fila de alto.
 */
export function Palette({ selected, onSelect }: Props) {
  return (
    <div
      className="palette"
      role="radiogroup"
      aria-label="Color"
    >
      {PALETTE.map((color, index) => (
        <button
          key={index}
          className="swatch"
          style={{ background: color.hex }}
          onClick={() => onSelect(index)}
          aria-pressed={index === selected}
          aria-label={index === 0 ? `${color.name} (borrar)` : color.name}
        />
      ))}
    </div>
  );
}
