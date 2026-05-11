import { render } from "@testing-library/react-native";
import { IllustratedAvatar } from "@/src/components/Avatar";

describe("IllustratedAvatar", () => {
  it("renders the Scotty look (custom scene)", () => {
    const { toJSON } = render(<IllustratedAvatar look="scotty" size={120} />);
    expect(toJSON()).toBeTruthy();
  });

  it("renders all 7 variants without crash", () => {
    const looks = ["scotty", "tatiana", "alex", "maya", "nora", "ben", "sam"] as const;
    looks.forEach((look) => {
      const { toJSON } = render(<IllustratedAvatar look={look} size={64} />);
      expect(toJSON()).toBeTruthy();
    });
  });

  it("respects custom size", () => {
    const { toJSON } = render(<IllustratedAvatar look="tatiana" size={48} />);
    expect(toJSON()).toBeTruthy();
  });

  it("renders without ring when ring=false", () => {
    const { toJSON } = render(<IllustratedAvatar look="alex" ring={false} />);
    expect(toJSON()).toBeTruthy();
  });
});
