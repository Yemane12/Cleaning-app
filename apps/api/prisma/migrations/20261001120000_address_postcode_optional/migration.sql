-- Many Ethiopian addresses have no postcode.
ALTER TABLE "addresses" ALTER COLUMN "postcode" DROP NOT NULL;
