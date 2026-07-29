# =============================================================================
# VPC CONFIGURATION
# =============================================================================
# Creates networking infrastructure for Exchange Layer

# =============================================================================
# VPC
# =============================================================================

resource "aws_vpc" "main" {
  count = var.create_new_vpc ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-${var.environment}-vpc"
  }
}

# Use existing VPC if provided
data "aws_vpc" "existing" {
  count = var.create_new_vpc ? 0 : 1
  id    = var.existing_vpc_id
}

locals {
  vpc_id   = var.create_new_vpc ? aws_vpc.main[0].id : data.aws_vpc.existing[0].id
  vpc_cidr = var.create_new_vpc ? aws_vpc.main[0].cidr_block : data.aws_vpc.existing[0].cidr_block
  azs      = slice(data.aws_availability_zones.available.names, 0, var.availability_zones_count)
}

# =============================================================================
# INTERNET GATEWAY
# =============================================================================

resource "aws_internet_gateway" "main" {
  count  = var.create_new_vpc ? 1 : 0
  vpc_id = local.vpc_id

  tags = {
    Name = "${var.project_name}-${var.environment}-igw"
  }
}

# Check for existing IGW if using existing VPC
data "aws_internet_gateway" "existing" {
  count = var.create_new_vpc ? 0 : 1

  filter {
    name   = "attachment.vpc-id"
    values = [local.vpc_id]
  }
}

locals {
  igw_id = var.create_new_vpc ? aws_internet_gateway.main[0].id : data.aws_internet_gateway.existing[0].id
}

# =============================================================================
# PUBLIC SUBNETS (for ALB)
# =============================================================================

resource "aws_subnet" "public" {
  count = var.availability_zones_count

  vpc_id                  = local.vpc_id
  cidr_block              = var.create_new_vpc ? cidrsubnet(var.vpc_cidr, 8, count.index + 1) : "172.31.${count.index + 75}.0/24"
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-${var.environment}-public-${count.index + 1}"
    Type = "Public"
  }
}

# =============================================================================
# PRIVATE SUBNETS (for ECS)
# =============================================================================

resource "aws_subnet" "private" {
  count = var.availability_zones_count

  vpc_id            = local.vpc_id
  cidr_block        = var.create_new_vpc ? cidrsubnet(var.vpc_cidr, 8, count.index + 10) : "172.31.${count.index + 85}.0/24"
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${var.project_name}-${var.environment}-private-${count.index + 1}"
    Type = "Private"
  }
}

# =============================================================================
# DATABASE SUBNETS
# =============================================================================

resource "aws_subnet" "database" {
  count = var.availability_zones_count

  vpc_id            = local.vpc_id
  cidr_block        = var.create_new_vpc ? cidrsubnet(var.vpc_cidr, 8, count.index + 20) : "172.31.${count.index + 100}.0/24"
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${var.project_name}-${var.environment}-db-${count.index + 1}"
    Type = "Database"
  }
}

# =============================================================================
# NAT GATEWAY (private subnet internet access)
# =============================================================================
# The app's third-party calls need this: VPC endpoints only reach AWS services,
# so without a NAT the tasks cannot reach the Trust Layer (C3) or Fraunhofer
# (C2) at all. One gateway serves both AZs — cheaper than one per AZ, at the
# cost of egress going down with that AZ. Its Elastic IP is the app's fixed
# outbound address, so third parties can allowlist it (see `nat_public_ip`).

# This account is at its Elastic IP quota, so allocating a fresh one fails with
# AddressLimitExceeded. Set nat_eip_public_ip to an address that is already
# allocated and unassociated to reuse it; leave it empty to allocate a new one.
data "aws_eip" "nat_existing" {
  count     = var.create_nat_gateway && var.nat_eip_public_ip != "" ? 1 : 0
  public_ip = var.nat_eip_public_ip
}

resource "aws_eip" "nat" {
  count  = var.create_nat_gateway && var.nat_eip_public_ip == "" ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${var.project_name}-${var.environment}-nat-eip"
  }
}

locals {
  nat_eip_allocation_id = var.create_nat_gateway ? (
    var.nat_eip_public_ip != "" ? data.aws_eip.nat_existing[0].id : aws_eip.nat[0].id
  ) : null

  nat_eip_public_ip = var.create_nat_gateway ? (
    var.nat_eip_public_ip != "" ? data.aws_eip.nat_existing[0].public_ip : aws_eip.nat[0].public_ip
  ) : null
}

resource "aws_nat_gateway" "main" {
  count         = var.create_nat_gateway ? 1 : 0
  allocation_id = local.nat_eip_allocation_id
  subnet_id     = aws_subnet.public[0].id

  tags = {
    Name = "${var.project_name}-${var.environment}-nat"
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route" "private_nat" {
  count                  = var.create_nat_gateway ? var.availability_zones_count : 0
  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[0].id
}

# =============================================================================
# ROUTE TABLES
# =============================================================================

# Public route table
resource "aws_route_table" "public" {
  vpc_id = local.vpc_id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = local.igw_id
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-public-rt"
  }
}

# Private route tables. Default route to the NAT gateway is added separately in
# aws_route.private_nat so toggling create_nat_gateway doesn't churn the tables.
resource "aws_route_table" "private" {
  count  = var.availability_zones_count
  vpc_id = local.vpc_id

  tags = {
    Name = "${var.project_name}-${var.environment}-private-rt-${count.index + 1}"
  }
}

# Database route table
resource "aws_route_table" "database" {
  vpc_id = local.vpc_id

  tags = {
    Name = "${var.project_name}-${var.environment}-db-rt"
  }
}

# =============================================================================
# ROUTE TABLE ASSOCIATIONS
# =============================================================================

resource "aws_route_table_association" "public" {
  count          = var.availability_zones_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = var.availability_zones_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table_association" "database" {
  count          = var.availability_zones_count
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}
