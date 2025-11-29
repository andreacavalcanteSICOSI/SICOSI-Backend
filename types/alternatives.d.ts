import type { AlternativesConfig } from './index';

declare module '@/data/alternatives.json' {
  const value: AlternativesConfig;
  export default value;
}

declare module '../data/alternatives.json' {
  const value: AlternativesConfig;
  export default value;
}

declare module '../../data/alternatives.json' {
  const value: AlternativesConfig;
  export default value;
}

declare module '../../../data/alternatives.json' {
  const value: AlternativesConfig;
  export default value;
}
