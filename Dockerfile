FROM node:lts-alpine

# Fonts for server-side SVG-to-PNG rendering of the stats OG image.
# Without these, resvg silently drops all text from the rendered card.
RUN apk add --no-cache font-dejavu

COPY app /notesx/app
COPY db /notesx/db
COPY userfiles /notesx/userfiles
# Keep the entrypoint OUTSIDE /notesx: a persistent volume mounted at /notesx
# (e.g. on Railway) would otherwise shadow it and the file would vanish at runtime.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /notesx/app

RUN npm install --omit=dev

ARG PACKAGE_VERSION
ENV APP_VERSION=${PACKAGE_VERSION}
ENV NODE_ENV=production

# Build without type checking, as we have removed the Typescript
# dev-dependencies above to save space in the final build.
# Type checking is done in the repo before building the image.
RUN npx tsc --noCheck

# ENTRYPOINT (not CMD) so the platform can't prepend `node` to our shell script.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
