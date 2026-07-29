# =============================================================================
# TRUST LAYER (C3) — token signing key
# =============================================================================
# The Exchange Layer mints its own Connector 3 bearer tokens, short-lived, from
# the private JWK held here; the Trust Layer only verifies them against the
# matching public key. Nothing long-lived exists on either side: no token to
# renew annually, no credential on anyone's laptop, and a Trust Layer restart
# changes nothing.
#
# The key value is deliberately NOT in Terraform — state is local and
# unencrypted, so it is written straight to Secrets Manager and Terraform keeps
# only a placeholder:
#
#   aws secretsmanager put-secret-value --region eu-central-1 \
#     --secret-id $(terraform output -raw connector_token_key_secret_arn) \
#     --secret-string "$(cat connector-token-private.jwk.b64)"
#
# Rotation (no downtime, no code change):
#   1. Generate a new ES256 key pair with a fresh `kid`.
#   2. Append its public JWK to CONNECTOR_TOKEN_PUBLIC_JWKS on the Trust Layer
#      and restart it — both keys are now accepted.
#   3. put-secret-value the new private JWK here, then restart the ECS service.
#      New tokens carry the new `kid`; in-flight old ones still verify.
#   4. Drop the old public JWK from the Trust Layer.

resource "aws_secretsmanager_secret" "connector_token_key" {
  name_prefix             = "${var.project_name}-${var.environment}-connector-token-key-"
  description             = "Private JWK (ES256) the Exchange Layer signs Connector 3 bearer tokens with"
  recovery_window_in_days = var.environment == "prod" ? 7 : 0

  tags = {
    Name = "${var.project_name}-${var.environment}-connector-token-key"
  }
}

resource "aws_secretsmanager_secret_version" "connector_token_key" {
  secret_id     = aws_secretsmanager_secret.connector_token_key.id
  secret_string = "replace-me-with-a-private-jwk"

  # The real key is set out of band (see above). Without this, every apply would
  # overwrite it with the placeholder and break signing.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
