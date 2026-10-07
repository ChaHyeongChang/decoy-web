// shared는 브라우저와 Node 양쪽에서 돈다. 두 환경에 공통으로 있는 전역만 선언한다.
declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare const performance: { now(): number };
