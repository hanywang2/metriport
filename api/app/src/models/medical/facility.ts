import { DataTypes, Sequelize } from "sequelize";
import { Config } from "../../shared/config";
import { OIDNode, OID_ID_START } from "../../shared/oid";
import { BaseModel, defaultModelOptions, ModelSetup } from "../_default";
import { Organization } from "./organization";

export class Facility extends BaseModel<Facility> {
  static NAME = "facility";
  declare id: string;
  declare cxId: string;
  declare organizationId: number;
  declare facilityId: number;
  declare data: object;

  static setup: ModelSetup = (sequelize: Sequelize) => {
    Facility.init(
      {
        ...BaseModel.baseAttributes(),
        id: {
          type: DataTypes.STRING,
          primaryKey: true,
        },
        cxId: {
          type: DataTypes.UUID,
        },
        organizationId: {
          type: DataTypes.INTEGER,
          references: { model: Organization.NAME, key: "organization_id" },
        },
        facilityId: {
          type: DataTypes.INTEGER,
        },
        data: {
          type: DataTypes.JSONB,
        },
      },
      {
        ...defaultModelOptions(sequelize),
        tableName: Facility.NAME,
        hooks: {
          async beforeCreate(attributes) {
            const curMaxId = (await Facility.max("facilityId", {
              where: {
                organizationId: attributes.organizationId,
              },
            })) as number;
            const facId = curMaxId ? curMaxId + 1 : OID_ID_START;
            attributes.id = `${Config.getSystemRootOID()}.${OIDNode.organizations}.${
              attributes.organizationId
            }.${OIDNode.locations}.${facId}`;
            attributes.facilityId = facId;
          },
        },
      }
    );
    Facility.belongsTo(Organization);
  };
}
