import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [index("routes/home.tsx"), route("api/generate", "routes/api.generate.ts"), route("api/generations", "routes/api.generations.ts")] satisfies RouteConfig;
