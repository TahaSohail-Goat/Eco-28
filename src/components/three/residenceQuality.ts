/** Phones, tablets and low-core devices get reduced assets and render settings. */
export const liteResidence=typeof window!=="undefined"&&(
  matchMedia("(max-width: 767px), (pointer: coarse)").matches||(navigator.hardwareConcurrency??8)<=4);
