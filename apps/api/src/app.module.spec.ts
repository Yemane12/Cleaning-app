import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { AuthService } from './auth/auth.service';
import { KycService } from './kyc/kyc.service';
import { S3StorageService } from './storage/s3-storage.service';
import { SupabaseJwtStrategy } from './auth/strategies/supabase-jwt.strategy';
import { validateEnv } from './config/env.validation';

/**
 * Wires the real module graph with only the database stubbed out. Catches
 * provider/import mistakes — a guard missing its Reflector, a service exported
 * from the wrong module — that unit tests on individual classes cannot see.
 */
describe('AppModule', () => {
  // Mirrors src/test/setup-env.ts, which populates process.env before the
  // AppModule import triggers config validation.
  const env = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    SUPABASE_URL: 'https://project.supabase.co',
    AWS_REGION: 'eu-west-2',
    KYC_S3_BUCKET: 'kyc-documents',
  };

  const compile = () =>
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), enableShutdownHooks: jest.fn() })
      .compile();

  it('resolves every provider in the graph', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(AuthService)).toBeInstanceOf(AuthService);
    expect(moduleRef.get(KycService)).toBeInstanceOf(KycService);
    expect(moduleRef.get(S3StorageService)).toBeInstanceOf(S3StorageService);
    expect(moduleRef.get(SupabaseJwtStrategy)).toBeInstanceOf(SupabaseJwtStrategy);

    await moduleRef.close();
  });

  it('refuses to boot without the required configuration', () => {
    expect(() => validateEnv({ ...env, DATABASE_URL: undefined })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('accepts a JWKS-only Supabase configuration', () => {
    expect(() => validateEnv(env)).not.toThrow();
  });
});
