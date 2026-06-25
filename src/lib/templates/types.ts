export interface TemplateMod {
  provider: "thunderstore" | "workshop" | "manual";
  packageId: string;
  name: string;
}

export interface TemplateConfigOverride {
  path: string;
  strategy: "template" | "iniMerge" | "jsonMerge";
  content: string;
}

export interface TemplatePayload {
  version: string;
  mods: TemplateMod[];
  configOverrides: TemplateConfigOverride[];
  startupParams: Record<string, string>;
}
