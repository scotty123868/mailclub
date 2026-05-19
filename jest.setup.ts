jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// Mock Supabase client + API so tests stay offline. The context detects this
// (SUPABASE_CONFIGURED=false) and falls through to the local-only paths that
// the tests already exercise.
jest.mock("@/src/services/supabase", () => ({
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
      signUp: jest.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
      signInWithPassword: jest.fn().mockResolvedValue({ data: { user: null, session: null }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    storage: {
      from: jest.fn().mockReturnValue({
        upload: jest.fn().mockResolvedValue({ data: null, error: null }),
        createSignedUrl: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  },
  SUPABASE_CONFIGURED: false,
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

jest.mock("expo-apple-authentication", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    AppleAuthenticationButton: (props: any) =>
      React.createElement(View, { ...props, "data-apple-button": true }, props.children),
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    isAvailableAsync: jest.fn().mockResolvedValue(false),
    signInAsync: jest.fn().mockResolvedValue({
      identityToken: null,
      email: null,
      fullName: null,
      user: "mock-apple-user-id",
    }),
  };
});

jest.mock("react-native-view-shot", () => ({
  captureRef: jest.fn().mockResolvedValue("file:///mock/capture.png"),
  default: () => null,
  ViewShot: ({ children }: any) => children ?? null,
}));

jest.mock("@stripe/stripe-react-native", () => {
  const React = require("react");
  return {
    StripeProvider: ({ children }: any) => children ?? null,
    initPaymentSheet: jest.fn().mockResolvedValue({ error: undefined }),
    presentPaymentSheet: jest.fn().mockResolvedValue({ error: undefined }),
    useStripe: () => ({
      initPaymentSheet: jest.fn().mockResolvedValue({ error: undefined }),
      presentPaymentSheet: jest.fn().mockResolvedValue({ error: undefined }),
    }),
  };
});

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

jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Mock = (name: string) => (props: any) =>
    React.createElement(View, { ...props, "data-map": name }, props.children);
  return {
    __esModule: true,
    default: Mock("MapView"),
    MapView: Mock("MapView"),
    Marker: Mock("Marker"),
    Polyline: Mock("Polyline"),
    Polygon: Mock("Polygon"),
    Circle: Mock("MapCircle"),
    Callout: Mock("Callout"),
    PROVIDER_GOOGLE: "google",
    PROVIDER_DEFAULT: "default",
  };
});

// v0.7.0.4: @gorhom/bottom-sheet pulls in reanimated worklets and
// gesture-handler in ways that crash react-test-renderer. Stub the
// surface our screens use (BottomSheet, BottomSheetView, BottomSheetBackdrop,
// BottomSheetModalProvider) with simple passthrough Views. We keep the
// ref API so screens that imperatively call .open()/.close()/.snapToIndex()
// don't crash.
jest.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");
  const { View } = require("react-native");
  const BottomSheetMock = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      snapToIndex: jest.fn(),
      close: jest.fn(),
      expand: jest.fn(),
      collapse: jest.fn(),
    }));
    return React.createElement(View, { ...props, "data-bottomsheet": true }, props.children);
  });
  return {
    __esModule: true,
    default: BottomSheetMock,
    BottomSheet: BottomSheetMock,
    BottomSheetView: (props: any) =>
      React.createElement(View, props, props.children),
    BottomSheetScrollView: (props: any) =>
      React.createElement(View, props, props.children),
    BottomSheetBackdrop: (props: any) =>
      React.createElement(View, props, props.children),
    BottomSheetModal: BottomSheetMock,
    BottomSheetModalProvider: (props: any) =>
      React.createElement(View, props, props.children),
    useBottomSheet: () => ({ close: jest.fn(), snapToIndex: jest.fn() }),
  };
});

jest.mock("react-native-gesture-handler", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    GestureHandlerRootView: (props: any) =>
      React.createElement(View, props, props.children),
    GestureDetector: (props: any) =>
      React.createElement(View, props, props.children),
    Gesture: {
      // v0.7.0.49: Pan() now uses .activeOffsetX/.activeOffsetY (single-
      // finger pan with threshold) instead of .minPointers/.maxPointers.
      // The mock returns a fluent builder that accepts EVERY common
      // method as a no-op so any future builder method change doesn't
      // break this mock again.
      Pan: () => {
        const noop = (): any => builder;
        const builder: any = new Proxy(
          {},
          {
            get() {
              return noop;
            },
          },
        );
        return builder;
      },
      Pinch: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }),
      Tap: () => ({ numberOfTaps: () => ({ onEnd: () => ({}) }) }),
      Simultaneous: (...args: any[]) => args,
      Exclusive: (...args: any[]) => args,
    },
    PanGestureHandler: (props: any) =>
      React.createElement(View, props, props.children),
    PinchGestureHandler: (props: any) =>
      React.createElement(View, props, props.children),
    TapGestureHandler: (props: any) =>
      React.createElement(View, props, props.children),
    State: {},
    Directions: {},
  };
});

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
    Ellipse: Mock("Ellipse"),
    Rect: Mock("Rect"),
    Path: Mock("Path"),
    Line: Mock("Line"),
    Polygon: Mock("Polygon"),
    Polyline: Mock("Polyline"),
    G: Mock("G"),
    Defs: Mock("Defs"),
    LinearGradient: Mock("SvgLinearGradient"),
    RadialGradient: Mock("RadialGradient"),
    Stop: Mock("Stop"),
    Pattern: Mock("Pattern"),
    Mask: Mock("Mask"),
    ClipPath: Mock("ClipPath"),
    Use: Mock("Use"),
    Symbol: Mock("Symbol"),
    Marker: Mock("Marker"),
    ForeignObject: Mock("ForeignObject"),
    Text: (props: any) => React.createElement(Text, props, props.children),
    TextPath: (props: any) => React.createElement(Text, props, props.children),
  };
});
