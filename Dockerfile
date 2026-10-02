# Zendscape explorer. Snapshots are captured with reli elsewhere and mounted here.
# Alpine: exploring only reads .rmem files, so reli's glibc-specific process
# readers are never used and musl is enough (docs/spike-0.md, macOS works likewise).
FROM php:8.4-cli-alpine AS build

RUN apk add --no-cache libffi-dev \
    && docker-php-ext-install ffi pcntl

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-progress --no-autoloader
COPY backend/bin backend/bin
COPY backend/src backend/src
COPY backend/public backend/public
RUN composer dump-autoload --no-dev --classmap-authoritative

# Same base image, so the extensions built above load as is; only their runtime libraries are kept.
FROM php:8.4-cli-alpine
RUN apk add --no-cache libffi
COPY --from=build /usr/local/lib/php/extensions /usr/local/lib/php/extensions
COPY --from=build /usr/local/etc/php/conf.d /usr/local/etc/php/conf.d
COPY --from=build /app /app

# Inside the container the server must listen beyond loopback to be published;
# `docker run -p 127.0.0.1:7777:7777` keeps it on the host's loopback (ADR 0007).
ENV ZENDSCAPE_HOST=0.0.0.0
EXPOSE 7777
ENTRYPOINT ["php", "/app/backend/bin/zendscape"]
CMD ["serve"]
