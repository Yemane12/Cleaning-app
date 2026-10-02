-- Services can carry an Amharic name and description; empty means "show the English".
ALTER TABLE "services" ADD COLUMN "nameAm" TEXT,
ADD COLUMN "descriptionAm" TEXT;
