import { PALETTE } from "../palette";

interface Props {
  selected: number;
  onSelect: (index: number) => void;
}

export function Palette({ selected, onSelect }: Props) {
  return (
    <div className="palette">
      {PALETTE.map((color, index) => (
        <button
          key={index}
          className={index === selected ? "swatch selected" : "swatch"}
          style={{ background: color.hex }}
          onClick={() => onSelect(index)}
          aria-label={color.name}
          title={index === 0 ? `${color.name} (borrar)` : color.name}
        />
      ))}
    </div>
  );
}
