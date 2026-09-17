// The package ships types, but its "exports" map hides them from Bundler resolution.
declare module "dom-accessibility-api" {
  export function computeAccessibleName(element: Element): string;
}
