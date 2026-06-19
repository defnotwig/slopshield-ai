"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const argon2 = __importStar(require("argon2"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding database...');
    // Create demo users
    const hashedPassword = await argon2.hash('password123');
    const users = [
        {
            name: 'Developer Alice',
            email: 'alice@example.com',
            password: hashedPassword,
            role: 'developer',
        },
        {
            name: 'Reviewer Bob',
            email: 'bob@example.com',
            password: hashedPassword,
            role: 'reviewer',
        },
        {
            name: 'Team Lead Charlie',
            email: 'charlie@example.com',
            password: hashedPassword,
            role: 'team-lead',
        },
        {
            name: 'Admin Admin',
            email: 'admin@example.com',
            password: hashedPassword,
            role: 'admin',
        },
    ];
    for (const u of users) {
        await prisma.user.upsert({
            where: { email: u.email },
            update: {},
            create: u,
        });
    }
    console.log('Demo users seeded.');
    // Create demo project
    const project = await prisma.project.upsert({
        where: { id: '9bc6279f-09e8-4228-aa92-803a5661d4bd' }, // fixed uuid for seeder consistency
        update: {},
        create: {
            id: '9bc6279f-09e8-4228-aa92-803a5661d4bd',
            name: 'SlopShield Demo Project',
            repositoryUrl: 'https://github.com/slopshield/demo',
            framework: 'React / Next.js',
            minimumScore: 80,
        },
    });
    console.log('Demo project seeded:', project.name);
}
main()
    .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map