export function playerStatusAfterBan(): "BANNED" { return "BANNED"; }
export function playerStatusAfterUnban(hasWhitelists: boolean): "TRUSTED" | "NEUTRAL" {
  return hasWhitelists ? "TRUSTED" : "NEUTRAL";
}
