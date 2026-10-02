import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateServiceDto, UpdateServiceDto } from './service.dto';

describe('service DTOs', () => {
  const service = {
    slug: 'standard-clean',
    name: 'Standard clean',
    category: 'STANDARD_CLEAN',
    baseDurationMinutes: 120,
    basePriceMinor: 100_000,
    pricePerHalfHourMinor: 15_000,
  };

  const problems = (type: new () => object, body: object) =>
    validateSync(plainToInstance(type, body)).map((error) => error.property);

  it('takes an Amharic name and description, or neither', () => {
    expect(problems(CreateServiceDto, service)).toEqual([]);
    expect(
      problems(CreateServiceDto, {
        ...service,
        nameAm: 'መደበኛ ጽዳት',
        descriptionAm: 'ኩሽና፣ መታጠቢያ ቤት፣ ወለል',
      }),
    ).toEqual([]);
    expect(problems(UpdateServiceDto, { nameAm: 'መደበኛ ጽዳት' })).toEqual([]);
  });

  it('holds the Amharic to the same limits as the English', () => {
    expect(problems(CreateServiceDto, { ...service, nameAm: 'ጽ'.repeat(121) })).toEqual(['nameAm']);
    expect(problems(UpdateServiceDto, { descriptionAm: 'ጽ'.repeat(1001) })).toEqual([
      'descriptionAm',
    ]);
    expect(problems(UpdateServiceDto, { nameAm: 42 })).toEqual(['nameAm']);
  });
});
