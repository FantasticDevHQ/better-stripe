import schema from './component/schema';

export { schema };

export const modules = import.meta.glob('./component/**/*.ts');
