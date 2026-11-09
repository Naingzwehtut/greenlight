export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(`warning: ${m}`),
  error: (m) => console.error(`error: ${m}`),
  debug: (m) => {
    if (process.env.GREENLIGHT_DEBUG) console.log(`debug: ${m}`);
  },
};

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
