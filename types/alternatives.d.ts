// types/alternatives.d.ts
declare module '@/data/alternatives.json' {
  const value: {
    metadata: {
      version: string;
      last_updated: string;
      description: string;
    };
    categories: {
      [key: string]: {
        name: string;
        description: string;
        sustainability_criteria: {
          [key: string]: string | string[];
        };
        certifications: string[];
        references?: string[];
      };
    };
  };
  export default value;
}