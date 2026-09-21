// Telling the header that the signed-in person's name or picture just changed.
//
// The header reads them from the session cookie, which only catches up once Auth.js re-issues it -
// and Auth.js ignores an update request made while it is still loading the session. This event
// lets the header show the new values at once, whatever the cookie is doing; the cookie is then
// brought up to date in the background so a reload agrees.
export const PROFILE_UPDATED = "onestop:profile-updated";

export interface ProfilePatch {
  name?: string;
  image?: string | null;
}

export function announceProfileChange(patch: ProfilePatch): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ProfilePatch>(PROFILE_UPDATED, { detail: patch }));
  }
}
