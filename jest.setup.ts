jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///fake/photo.jpg" }],
  }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({
    granted: true,
    status: "granted",
  }),
  MediaTypeOptions: { Images: "Images" },
}));

jest.mock("expo-linear-gradient", () => {
  const { View } = require("react-native");
  return { LinearGradient: View };
});

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => null,
  Stack: ({ children }: any) => children ?? null,
  Tabs: ({ children }: any) => children ?? null,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: any) => children ?? null,
}));

jest.mock("expo-font", () => ({
  useFonts: () => [true],
  loadAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("react-native-svg", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  const Mock = (name: string) => (props: any) =>
    React.createElement(View, { ...props, "data-svg": name }, props.children);
  return {
    __esModule: true,
    default: Mock("Svg"),
    Svg: Mock("Svg"),
    Circle: Mock("Circle"),
    Rect: Mock("Rect"),
    Path: Mock("Path"),
    Line: Mock("Line"),
    G: Mock("G"),
    Defs: Mock("Defs"),
    LinearGradient: Mock("SvgLinearGradient"),
    RadialGradient: Mock("RadialGradient"),
    Stop: Mock("Stop"),
    Pattern: Mock("Pattern"),
    Mask: Mock("Mask"),
    ClipPath: Mock("ClipPath"),
    Text: (props: any) => React.createElement(Text, props, props.children),
    TextPath: (props: any) => React.createElement(Text, props, props.children),
  };
});
