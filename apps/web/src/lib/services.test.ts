import { describe, expect, it } from 'vitest';
import { serviceDescription, serviceName } from './services';

describe('service text', () => {
  const service = {
    name: 'Standard clean',
    description: 'Kitchen, bathroom, floors',
    nameAm: 'መደበኛ ጽዳት',
    descriptionAm: 'ኩሽና፣ መታጠቢያ ቤት፣ ወለል',
  };

  it('is in Amharic where the service has it', () => {
    expect(serviceName(service, 'am')).toBe('መደበኛ ጽዳት');
    expect(serviceDescription(service, 'am')).toBe('ኩሽና፣ መታጠቢያ ቤት፣ ወለል');
  });

  it('stays in English for English readers', () => {
    expect(serviceName(service, 'en')).toBe('Standard clean');
    expect(serviceDescription(service, 'en')).toBe('Kitchen, bathroom, floors');
  });

  // A service added before anyone translated it still needs a name.
  it('falls back to English where no Amharic was given', () => {
    const untranslated = { name: 'Deep clean', description: null, nameAm: null };
    expect(serviceName(untranslated, 'am')).toBe('Deep clean');
    expect(serviceDescription(untranslated, 'am')).toBeNull();
    expect(serviceName({ ...service, nameAm: '  ' }, 'am')).toBe('Standard clean');
    expect(serviceName({ name: 'Standard clean' }, 'am')).toBe('Standard clean');
  });
});
