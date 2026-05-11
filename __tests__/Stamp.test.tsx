import { render } from "@testing-library/react-native";
import { Stamp } from "@/src/components/Stamp";

describe("Stamp", () => {
  it("renders with default props (dove, red, 5¢)", () => {
    const { toJSON } = render(<Stamp />);
    expect(toJSON()).toBeTruthy();
  });

  it("renders all motif variants without crash", () => {
    const motifs = ["dove", "botanical", "mountain", "lighthouse", "moon", "compass"] as const;
    motifs.forEach((m) => {
      const { toJSON } = render(<Stamp motif={m} />);
      expect(toJSON()).toBeTruthy();
    });
  });

  it("renders all tone variants without crash", () => {
    const tones = ["red", "sage", "blue", "gold", "night"] as const;
    tones.forEach((t) => {
      const { toJSON } = render(<Stamp tone={t} />);
      expect(toJSON()).toBeTruthy();
    });
  });

  it("renders all sizes (sm/md/lg) without crash", () => {
    const sizes = ["sm", "md", "lg"] as const;
    sizes.forEach((s) => {
      const { toJSON } = render(<Stamp size={s} />);
      expect(toJSON()).toBeTruthy();
    });
  });

  it("displays the supplied denomination", () => {
    const { getByText } = render(<Stamp cents="20¢" />);
    expect(getByText("20¢")).toBeTruthy();
  });

  it("includes 'MAIL CLUB' microtext", () => {
    const { getByText } = render(<Stamp />);
    expect(getByText("MAIL CLUB")).toBeTruthy();
  });
});
